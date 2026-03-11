/**
 * pi-mem - Persistent memory extension for pi
 *
 * Captures tool observations via an LLM observer agent that extracts
 * structured data (type, title, facts, narrative, concepts, files) from
 * full tool output. Stores structured observations in LanceDB, generates
 * AI-powered session summaries, and injects relevant context into
 * future sessions.
 *
 * Summarization follows the "checkpoint" model: each agent_end produces
 * a fresh summary, replacing any previous one for the session.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadConfig, type PiMemConfig } from "./config.js";
import { getProjectSlug } from "./project.js";
import { stripPrivateTags } from "./observer.js";
import { extractObservation, shouldSkipObservation } from "./observer-agent.js";
import { summarize, type SessionSummary } from "./compression-agent.js";
import {
	initStore,
	addObservation,
	addPrompt,
	addSummary,
	addManualMemory,
	getSessionObservations,
	deleteSessionSummaries,
	hybridSearch,
	timelineSearch,
	getObservationsByIds,
	compactAndReindex,
	type ObservationStore,
} from "./observation-store.js";
import { loadIgnorePatterns, shouldIgnorePath } from "./privacy.js";
import { buildInjectedContext } from "./context-injection.js";
import { registerTools } from "./tools.js";
import { MemoryBrowser } from "./memory-browser.js";
import { homedir } from "node:os";
import { join } from "node:path";

// Redirect LanceDB/Lance Rust log output to a file instead of stderr
if (!process.env.LANCE_LOG_FILE) {
	process.env.LANCE_LOG_FILE = join(homedir(), ".pi-mem", "lance.log");
}

export default function piMem(pi: ExtensionAPI) {
	let config: PiMemConfig;
	let projectSlug: string;
	let store: ObservationStore | null = null;
	let sessionId: string;
	let ignorePatterns: string[] = [];
	let enabled = false;
	let observationCount = 0;

	// ─── CLI Flag ─────────────────────────────────────────────────
	pi.registerFlag("no-mem", {
		description: "Disable pi-mem for this session",
		type: "boolean",
		default: false,
	});

	// ─── Session Start ────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		config = loadConfig();

		if (!config.enabled || pi.getFlag("--no-mem")) {
			enabled = false;
			if (pi.getFlag("--no-mem")) {
				const theme = ctx.ui.theme;
				ctx.ui.setStatus("pi-mem", theme.fg("dim", "⌬ disabled (--no-mem)"));
			}
			return;
		}
		enabled = true;

		projectSlug = await getProjectSlug(ctx.cwd);
		sessionId = crypto.randomUUID().slice(0, 8);
		observationCount = 0;
		ignorePatterns = loadIgnorePatterns(ctx.cwd);

		// Initialize observation store (graceful degradation)
		try {
			store = await initStore(config, { modelRegistry: ctx.modelRegistry });
		} catch {
			store = null;
		}

		const theme = ctx.ui.theme;
		ctx.ui.setStatus("pi-mem", theme.fg("dim", `⌬ ${projectSlug}`));

	});

	// ─── Tool Result Capture ──────────────────────────────────────
	pi.on("tool_result", async (event, ctx) => {
		if (!enabled || !store) return;

		const toolName = event.toolName;
		const input = event.input as Record<string, unknown>;

		// Privacy: check if file path should be ignored
		const filePath = (input.path || input.file_path) as string | undefined;
		if (filePath && shouldIgnorePath(filePath, ignorePatterns)) {
			return;
		}

		// Extract text from content (full, untruncated)
		let output = "";
		if (event.content) {
			for (const part of event.content) {
				if (part.type === "text") output += part.text;
			}
		}

		// Privacy: strip <private> tags
		output = stripPrivateTags(output);

		// Skip check: low-value tool executions
		if (shouldSkipObservation(toolName, output)) {
			return;
		}

		// Deterministic file extraction from tool input (ground truth)
		const deterministicFiles = extractFiles(input);
		const toolIsRead = toolName === "read";
		const toolIsWrite = toolName === "edit" || toolName === "write";

		// Fire-and-forget: extract structured observation via observer LLM
		const currentStore = store;
		(async () => {
			try {
				const parsed = await extractObservation(
					toolName,
					input,
					output,
					config,
					{
						model: ctx.model,
						thinkingLevel: pi.getThinkingLevel(),
					},
				);

				if (parsed) {
					// Merge deterministic files with observer-extracted files
					const filesRead = mergeFiles(
						toolIsRead ? deterministicFiles : [],
						parsed.files_read,
					);
					const filesModified = mergeFiles(
						toolIsWrite ? deterministicFiles : [],
						parsed.files_modified,
					);

					await addObservation(currentStore, {
						session_id: sessionId,
						project: projectSlug,
						timestamp: new Date().toISOString(),
						tool_name: toolName,
						obs_type: parsed.type,
						title: parsed.title,
						subtitle: parsed.subtitle || "",
						facts: parsed.facts,
						narrative: parsed.narrative || "",
						concepts: parsed.concepts,
						files_read: filesRead,
						files_modified: filesModified,
					});
				}
				// If observer returns null (failure/no XML), observation is simply not stored
			} catch {
				// Observer failed — observation is lost; fire-and-forget is intentional
			}
		})();

		observationCount++;

		// Update status
		const theme = ctx.ui.theme;
		ctx.ui.setStatus(
			"pi-mem",
			theme.fg("dim", `⌬ ${projectSlug} (${observationCount} obs)`),
		);
	});

	// ─── Agent End: Summarize ─────────────────────────────────────
	pi.on("agent_end", async (_event, ctx) => {
		if (!enabled || !store) return;

		const theme = ctx.ui.theme;

		// Fire-and-forget: don't block the extension dispatch pipeline.
		// The sequential handler loop in extensionRunner.emit() awaits each
		// handler — blocking here delays ALL extensions loaded after pi-mem.
		(async () => {
			try {
				// Query observations for this session from LanceDB
				const observations = await getSessionObservations(store, sessionId);

				if (observations.length < 3) {
					await compactAndReindex(store).catch(() => {});
					return;
				}

				ctx.ui.setStatus("pi-mem", theme.fg("warning", "⌬ Summarizing..."));

				// Collect files from structured observation data
				const { filesRead, filesModified } = collectFilesFromObservations(observations);

				// Build observation data for summarizer using structured fields
				const obsForSummary = observations.map((o) => ({
					timestamp: o.timestamp,
					toolName: o.tool_name,
					input: { summary: o.title } as Record<string, unknown>,
					output: o.narrative,
					cwd: "",
				}));

				const summary = await summarize(obsForSummary, config, {
					model: ctx.model,
					thinkingLevel: pi.getThinkingLevel(),
					filesRead,
					filesModified,
				});

				const summaryText = formatSessionSummary(summary, projectSlug, sessionId);

				const newId = await addSummary(store!, {
					session_id: sessionId,
					project: projectSlug,
					timestamp: new Date().toISOString(),
					title: extractSummaryTitle(summaryText),
					narrative: summaryText,
					concepts: summary.concepts,
					files_read: filesRead,
					files_modified: filesModified,
				});

				if (newId) {
					await deleteSessionSummaries(store!, sessionId, newId);
				}

				await compactAndReindex(store!);

				ctx.ui.setStatus("pi-mem", theme.fg("dim", `⌬ ${projectSlug} ✓`));
			} catch (e: any) {
				const errMsg = e?.message || String(e);
				try {
					const fs = await import("node:fs");
					fs.appendFileSync(
						join(homedir(), ".pi-mem", "debug-summarize.log"),
						`[${new Date().toISOString()}] agent_end error: ${errMsg}\n${e?.stack || ""}\n`,
					);
				} catch {}
				await compactAndReindex(store!).catch(() => {});
				ctx.ui.setStatus("pi-mem", theme.fg("error", "⌬ Summary failed"));
			}
		})();
	});

	// ─── Before Agent Start: Capture Prompt + Inject Context ──────
	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return;

		if (store && event.prompt) {
			await addPrompt(store, {
				session_id: sessionId,
				project: projectSlug,
				timestamp: new Date().toISOString(),
				text: event.prompt,
			});
		}

		if (!config.autoInject) return;

		try {
			const context = await buildInjectedContext(
				store,
				projectSlug,
				config,
				event.prompt,
			);

			if (context) {
				return {
					message: {
						customType: "pi-mem-context",
						content: context,
						display: false,
					},
				};
			}
		} catch {
			// Don't break the session if context injection fails
		}
	});

	// ─── Session Shutdown ─────────────────────────────────────────
	pi.on("session_shutdown", async (_event, _ctx) => {
		// Nothing special needed
	});

	// ─── /mem Command ─────────────────────────────────────────────
	pi.registerCommand("mem", {
		description: "Show pi-mem memory status",
		handler: async (_args, ctx) => {
			if (!enabled) {
				ctx.ui.notify("pi-mem is disabled", "info");
				return;
			}

			const storeStatus = store?.available ? "✓ available" : "✗ unavailable";
			const embedStatus = store?.embed ? "✓ configured" : "✗ not configured";

			ctx.ui.notify(
				`pi-mem status:\n` +
					`  Project: ${projectSlug}\n` +
					`  Session: ${sessionId}\n` +
					`  Observations this session: ${observationCount}\n` +
					`  Store: ${storeStatus}\n` +
					`  Embeddings: ${embedStatus}`,
				"info",
			);
		},
	});

	// ─── /mem-disable Command ─────────────────────────────────────
	pi.registerCommand("mem-disable", {
		description: "Disable pi-mem for the rest of this session",
		handler: async (_args, ctx) => {
			if (!enabled) {
				ctx.ui.notify("pi-mem is already disabled", "info");
				return;
			}
			enabled = false;
			const theme = ctx.ui.theme;
			ctx.ui.setStatus("pi-mem", theme.fg("dim", "⌬ disabled"));
			ctx.ui.notify("pi-mem disabled for this session", "info");
		},
	});

	// ─── /mem-enable Command ──────────────────────────────────────
	pi.registerCommand("mem-enable", {
		description: "Re-enable pi-mem for this session",
		handler: async (_args, ctx) => {
			if (enabled) {
				ctx.ui.notify("pi-mem is already enabled", "info");
				return;
			}

			// Need config to be loaded
			if (!config) {
				config = loadConfig();
			}

			if (!config.enabled) {
				ctx.ui.notify("pi-mem is disabled in config — enable it in pi-mem.json first", "warning");
				return;
			}

			// Initialize store if not already done
			if (!store) {
				if (!projectSlug) {
					projectSlug = await getProjectSlug(ctx.cwd);
				}
				if (!sessionId) {
					sessionId = crypto.randomUUID().slice(0, 8);
				}
				ignorePatterns = loadIgnorePatterns(ctx.cwd);
				try {
					store = await initStore(config, { modelRegistry: ctx.modelRegistry });
				} catch {
					store = null;
				}
			}

			enabled = true;
			const theme = ctx.ui.theme;
			ctx.ui.setStatus(
				"pi-mem",
				theme.fg("dim", `⌬ ${projectSlug}${observationCount > 0 ? ` (${observationCount} obs)` : ""}`),
			);
			ctx.ui.notify("pi-mem enabled for this session", "info");
		},
	});

	// ─── /mem-browse Command ──────────────────────────────────────
	pi.registerCommand("mem-browse", {
		description: "Browse and manage pi-mem memories interactively",
		handler: async (_args, ctx) => {
			if (!enabled || !store?.available) {
				ctx.ui.notify("pi-mem is not available", "info");
				return;
			}

			await ctx.waitForIdle();

			// Track pending actions that require leaving custom UI
			let pendingAction: {
				type: "edit" | "delete";
				itemId: string;
				itemTitle: string;
				itemNarrative?: string;
			} | null = null;
			let browserInstance: MemoryBrowser | null = null;

			// Loop: show browser, handle actions that need native UI, re-show
			while (true) {
				pendingAction = null;

				await ctx.ui.custom<void>((tui, theme, _kb, done) => {
					const browser = new MemoryBrowser({
						store: store!,
						projectSlug,
						config,
						theme,
						tui,
						onClose: () => done(),
						onEdit: (id, title, narrative) => {
							pendingAction = { type: "edit", itemId: id, itemTitle: title, itemNarrative: narrative };
							done();
						},
						onDelete: (id, title) => {
							pendingAction = { type: "delete", itemId: id, itemTitle: title };
							done();
						},
					});

					browserInstance = browser;
					browser.init().catch(() => {});

					return {
						render(width: number): string[] {
							return browser.render(width);
						},
						handleInput(data: string): void {
							browser.handleInput(data).catch(() => {});
						},
						invalidate(): void {
							browser.invalidate();
						},
					};
				});

				// Handle pending action outside of custom UI
				if (!pendingAction) break; // User quit

				if (pendingAction.type === "delete") {
					const confirmed = await ctx.ui.confirm(
						"Delete Memory",
						`Delete "${pendingAction.itemTitle.slice(0, 60)}"?`,
					);
					if (confirmed) {
						const { deleteObservation: delObs, compactAndReindex: compact } = await import("./observation-store.js");
						await delObs(store!, pendingAction.itemId);
						await compact(store!);
						if (browserInstance) {
							browserInstance.removeItem(pendingAction.itemId);
						}
					}
				} else if (pendingAction.type === "edit") {
					const editText = `# Title\n${pendingAction.itemTitle}\n\n# Narrative\n${pendingAction.itemNarrative ?? ""}`;
					const result = await ctx.ui.editor("Edit Memory", editText);
					if (result !== undefined) {
						const titleMatch = result.match(/^# Title\n(.*?)(?:\n\n# Narrative|\n# Narrative)/s);
						const narrativeMatch = result.match(/# Narrative\n([\s\S]*?)$/);
						const newTitle = titleMatch?.[1]?.trim() ?? pendingAction.itemTitle;
						const newNarrative = narrativeMatch?.[1]?.trim() ?? pendingAction.itemNarrative ?? "";

						const fields: { title?: string; narrative?: string } = {};
						if (newTitle !== pendingAction.itemTitle) fields.title = newTitle;
						if (newNarrative !== (pendingAction.itemNarrative ?? "")) fields.narrative = newNarrative;

						if (Object.keys(fields).length > 0) {
							const { updateObservation: updObs, compactAndReindex: compact } = await import("./observation-store.js");
							await updObs(store!, pendingAction.itemId, fields);
							await compact(store!);
							if (browserInstance) {
								browserInstance.updateItem(pendingAction.itemId, fields);
							}
						}
					}
				}

				// Re-enter the browser loop
			}
		},
	});

	// ─── Register Search Tools ────────────────────────────────────
	registerTools(pi, {
		onSearch: async (params) => {
			if (!enabled || !store) return [];
			return hybridSearch(
				store,
				params.query,
				{
					project: params.project ?? projectSlug,
					obs_type: params.obs_type,
					dateStart: params.dateStart,
					dateEnd: params.dateEnd,
				},
				params.limit ?? 20,
				params.offset ?? 0,
			);
		},

		onTimeline: async (params) => {
			if (!enabled || !store) return [];
			return timelineSearch(store, {
				anchorId: params.anchor,
				query: params.query,
				depthBefore: params.depth_before,
				depthAfter: params.depth_after,
				project: params.project ?? projectSlug,
			});
		},

		onGetObservations: async (params) => {
			if (!enabled || !store) return [];
			return getObservationsByIds(store, params.ids);
		},

		onSaveMemory: async (params) => {
			if (!enabled || !store) return "pi-mem is not enabled.";

			const title = params.title || params.text.slice(0, 80);
			const concepts = params.concepts ? params.concepts.join(", ") : "";

			await addManualMemory(store, {
				session_id: sessionId,
				project: params.project ?? projectSlug,
				timestamp: new Date().toISOString(),
				title,
				text: params.text,
				concepts,
			});

			return `Memory saved: ${title}`;
		},
	});
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Collect file paths from structured observation data.
 */
function collectFilesFromObservations(observations: { files_read: string[]; files_modified: string[] }[]): {
	filesRead: string[];
	filesModified: string[];
} {
	const filesRead = new Set<string>();
	const filesModified = new Set<string>();

	for (const obs of observations) {
		for (const f of obs.files_read) filesRead.add(f);
		for (const f of obs.files_modified) filesModified.add(f);
	}

	return {
		filesRead: [...filesRead],
		filesModified: [...filesModified],
	};
}

/**
 * Merge deterministic file paths with observer-extracted file paths.
 * Deterministic paths are ground truth; observer paths are supplementary.
 */
function mergeFiles(deterministic: string[], observed: string[]): string[] {
	const merged = new Set(deterministic);
	for (const f of observed) merged.add(f);
	return [...merged];
}

function buildInputSummary(toolName: string, input: Record<string, unknown>): string {
	switch (toolName) {
		case "bash":
			return String(input.command ?? "").slice(0, 60);
		case "read":
			return String(input.path ?? "").slice(0, 60);
		case "edit":
			return String(input.path ?? "").slice(0, 60);
		case "write":
			return String(input.path ?? "").slice(0, 60);
		default: {
			const keys = Object.keys(input);
			if (keys.length === 0) return "(no input)";
			const firstVal = String(input[keys[0]] ?? "").slice(0, 40);
			return `${keys[0]}=${firstVal}`;
		}
	}
}

function extractFiles(input: Record<string, unknown>): string[] {
	const files: string[] = [];
	const path = input.path || input.file_path;
	if (typeof path === "string") files.push(path);
	return files;
}

function formatSessionSummary(summary: SessionSummary, project: string, sessionId: string): string {
	const parts = [
		`# Session Summary`,
		``,
		`**Project:** ${project}`,
		`**Date:** ${new Date().toISOString().split("T")[0]}`,
		`**Session:** ${sessionId}`,
		`**Concepts:** ${summary.concepts.length > 0 ? summary.concepts.join(", ") : "none"}`,
		``,
		`## Request`,
		summary.request || "Unknown request",
		``,
		`## What Was Investigated`,
		summary.investigated || "None",
		``,
		`## What Was Learned`,
		summary.learned || "None",
		``,
		`## What Was Completed`,
		summary.completed || "None",
		``,
		`## Next Steps`,
		summary.nextSteps || "None",
		``,
		`## Files`,
		`- **Read:** ${summary.filesRead.length > 0 ? summary.filesRead.join(", ") : "none"}`,
		`- **Modified:** ${summary.filesModified.length > 0 ? summary.filesModified.join(", ") : "none"}`,
		``,
		`## Concepts`,
		...(summary.concepts.length > 0 ? summary.concepts.map(c => `- ${c}`) : ["- none"]),
	];
	return parts.join("\n");
}

function extractSummaryTitle(summary: string): string {
	const requestMatch = summary.match(/## Request\s*\n(.*?)(\n|$)/);
	if (requestMatch) return requestMatch[1].trim().slice(0, 100);
	const lines = summary.split("\n").filter((l) => l.trim());
	return (lines[0] ?? "Session summary").slice(0, 100);
}
