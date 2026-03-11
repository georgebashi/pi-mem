/**
 * Compression agent for pi-mem.
 * Spawns a headless pi sub-agent to compress observations into structured summaries.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PiMemConfig } from "./config.js";

/** Observation shape as passed from index.ts to the summarizer */
export interface Observation {
	timestamp: string;
	toolName: string;
	input: Record<string, unknown>;
	output: string;
	cwd: string;
}

const DEBUG_LOG_PATH = path.join(os.homedir(), ".pi-mem", "debug-summarize.log");

function debugLog(msg: string) {
	try { fs.appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

export interface SessionSummary {
	request: string;
	investigated: string;
	learned: string;
	completed: string;
	nextSteps: string;
	filesRead: string[];
	filesModified: string[];
	concepts: string[];
}

export interface SummarizeContext {
	/** Current session model */
	model: any;
	/** Current session thinking level */
	thinkingLevel: string;
	/** Pre-collected file paths (overrides LLM extraction) */
	filesRead?: string[];
	/** Pre-collected file paths (overrides LLM extraction) */
	filesModified?: string[];
}

function killProcess(proc: ChildProcess): void {
	try { proc.kill("SIGTERM"); } catch {}
	setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 2000);
}

/**
 * Run a pi sub-agent and return the response text.
 */
function runSubAgent(
	prompt: string,
	systemPrompt: string,
	model: string,
	thinkingLevel: string,
): Promise<{ ok: true; response: string } | { ok: false; error: string }> {
	// Write prompt and system prompt to temp files to avoid exposing session
	// content via process arguments (visible in ps output)
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mem-summarize-"));
	const systemPromptPath = path.join(tmpDir, "system-prompt.md");
	const taskPath = path.join(tmpDir, "task.md");
	fs.writeFileSync(systemPromptPath, systemPrompt, { mode: 0o600 });
	fs.writeFileSync(taskPath, prompt, { mode: 0o600 });

	const cleanupTmp = () => {
		try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
	};

	return new Promise((resolve) => {
		const proc = spawn("pi", [
			"--mode", "json",
			"-p",
			"--no-session",
			"--no-tools",
			"--system-prompt", systemPromptPath,
			"--model", model,
			"--thinking", thinkingLevel,
			`@${taskPath}`,
		], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PI_MEM_SUB_AGENT: "1" },
		});

		let buffer = "";
		let lastAssistantText = "";
		let stderr = "";

		const timeout = setTimeout(() => {
			cleanupTmp();
			killProcess(proc);
			resolve({ ok: false, error: "Summarization timeout (90s)" });
		}, 90_000);

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line);
				if (event.type === "message_end" && event.message?.role === "assistant") {
					for (const part of event.message.content) {
						if (part.type === "text") {
							lastAssistantText = part.text;
						}
					}
				}
			} catch {
				// ignore non-JSON lines
			}
		};

		proc.stdout!.on("data", (data: Buffer) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});

		proc.stderr!.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			clearTimeout(timeout);
			cleanupTmp();
			if (buffer.trim()) processLine(buffer);

			if (lastAssistantText) {
				resolve({ ok: true, response: lastAssistantText });
			} else if (code !== 0) {
				resolve({ ok: false, error: `Sub-agent failed (exit ${code}): ${stderr.trim().slice(0, 500) || "(no output)"}` });
			} else {
				resolve({ ok: false, error: "Sub-agent returned no response" });
			}
		});

		proc.on("error", (err) => {
			clearTimeout(timeout);
			cleanupTmp();
			resolve({ ok: false, error: `Failed to spawn pi: ${err.message}` });
		});
	});
}

/**
 * Summarize observations using an LLM compression agent.
 * Falls back to raw observation extraction on failure.
 */
export async function summarize(
	observations: Observation[],
	config: PiMemConfig,
	context: SummarizeContext,
): Promise<SessionSummary> {
	// Resolve model: config override → current session model
	const model = config.summaryModel
		|| (context.model ? `${context.model.provider}/${context.model.id}` : undefined);

	// Resolve thinking level: config override → current session thinking level
	const thinkingLevel = config.thinkingLevel || context.thinkingLevel || "medium";

	if (!model) {
		debugLog("No model available, using fallback");
		const summary = extractFallbackSummary(observations);
		// Override with pre-collected files even for fallback
		if (context.filesRead) summary.filesRead = context.filesRead;
		if (context.filesModified) summary.filesModified = context.filesModified;
		return summary;
	}

	// Format observations into prompt — use structured titles and narratives
	// (already LLM-compressed by observer agent, no need to truncate)
	const obsText = observations.map((obs, i) => {
		return `### Observation ${i + 1}: ${obs.toolName} [${obs.timestamp}]
Title: ${JSON.stringify(obs.input).includes("summary") ? (obs.input as any).summary : obs.toolName}
Content: ${obs.output}`;
	}).join("\n\n");

	const prompt = `Compress the following coding session observations into a structured summary.

${obsText}

Respond with a structured markdown summary using EXACTLY these section headers:
## Request
## What Was Investigated
## What Was Learned
## What Was Completed
## Next Steps
## Files
## Concepts`;

	debugLog(`--- Starting summarization (${observations.length} obs, model: ${model}, thinking: ${thinkingLevel}) ---`);

	const result = await runSubAgent(prompt, COMPRESSION_SYSTEM_PROMPT, model, thinkingLevel);

	let summary: SessionSummary;
	if (result.ok) {
		debugLog(`Summarization succeeded. Response length: ${result.response.length}`);
		summary = parseSummaryResponse(result.response, observations);
	} else {
		debugLog(`Summarization failed: ${result.error}`);
		summary = extractFallbackSummary(observations);
	}

	// Override LLM file extraction with deterministic pre-collected files
	if (context.filesRead) summary.filesRead = context.filesRead;
	if (context.filesModified) summary.filesModified = context.filesModified;

	return summary;
}

const COMPRESSION_SYSTEM_PROMPT = `You are a memory compression agent. You observe tool executions from a coding session and produce structured summaries.

Your job is to distill raw tool observations into concise, meaningful memory entries.

Focus on:
- What was BUILT, FIXED, or LEARNED — not what the observer is doing
- Use action verbs: implemented, fixed, deployed, configured, migrated
- Extract key decisions, patterns, and discoveries
- List all files touched with their read/modified status
- Tag with relevant concepts from: bugfix, feature, refactor, discovery, how-it-works, problem-solution, architecture, configuration, testing, deployment, performance, security

Skip:
- Routine operations (empty status checks, simple file listings, package installs)
- Verbose tool output details
- Step-by-step narration of what was observed

Output format: structured markdown with these exact section headers:
## Request
## What Was Investigated
## What Was Learned
## What Was Completed
## Next Steps
## Files
## Concepts`;

/**
 * Parse the LLM response into a SessionSummary.
 */
export function parseSummaryResponse(response: string, observations: Observation[]): SessionSummary {
	const sections: Record<string, string> = {};
	let currentSection = "";

	for (const line of response.split("\n")) {
		const headerMatch = line.match(/^##\s+(.+)/);
		if (headerMatch) {
			currentSection = headerMatch[1].trim().toLowerCase();
			sections[currentSection] = "";
		} else if (currentSection) {
			sections[currentSection] = (sections[currentSection] + "\n" + line).trim();
		}
	}

	// Extract files
	const filesText = sections["files"] || "";
	const filesRead: string[] = [];
	const filesModified: string[] = [];

	for (const line of filesText.split("\n")) {
		const readMatch = line.match(/\*\*Read:\*\*\s*(.+)/i);
		const modMatch = line.match(/\*\*Modified:\*\*\s*(.+)/i);
		if (readMatch) filesRead.push(...readMatch[1].split(",").map((f) => f.trim()).filter(Boolean));
		if (modMatch) filesModified.push(...modMatch[1].split(",").map((f) => f.trim()).filter(Boolean));
	}

	// Extract concepts
	const conceptsText = sections["concepts"] || "";
	const concepts = conceptsText.split(/[,\n]/).map((c) => c.trim().replace(/^-\s*/, "")).filter(Boolean);

	return {
		request: sections["request"] || "Unknown request",
		investigated: sections["what was investigated"] || "",
		learned: sections["what was learned"] || "",
		completed: sections["what was completed"] || "",
		nextSteps: sections["next steps"] || "",
		filesRead,
		filesModified,
		concepts,
	};
}

/**
 * Extract a basic summary from observations without LLM help.
 * Uses structured fields (title) from observer-extracted observations.
 */
function extractFallbackSummary(observations: Observation[]): SessionSummary {
	const toolNames = [...new Set(observations.map((o) => o.toolName))];
	const titles = observations
		.map((o) => (o.input as any).summary || o.toolName)
		.filter(Boolean);

	return {
		request: "Session with tools: " + toolNames.join(", "),
		investigated: titles.length > 0
			? titles.slice(0, 10).join("; ")
			: `Used tools: ${toolNames.join(", ")} across ${observations.length} operations`,
		learned: "",
		completed: "",
		nextSteps: "",
		filesRead: [],
		filesModified: [],
		concepts: [],
	};
}
