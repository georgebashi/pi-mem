/**
 * Tool registration for pi-mem.
 * Registers search, timeline, get_observations, and save_memory tools.
 * Implements a 3-layer progressive disclosure pattern for memory search.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import type { IndexResult, TimelineResult, FullResult } from "./observation-store.js";

// ─── Result Formatters ────────────────────────────────────────

function formatIndexResults(results: IndexResult[]): string {
	if (results.length === 0) {
		return "No results found. Try broader search terms or different filters.";
	}

	const header = "| id | timestamp | type | tool | title |";
	const sep = "|---|---|---|---|---|";
	const rows = results.map(
		(r) =>
			`| ${r.id} | ${r.timestamp.slice(0, 16)} | ${r.obs_type || r.type} | ${r.tool_name || "-"} | ${r.title.slice(0, 60)} |`,
	);

	return [
		`Found ${results.length} result(s):`,
		"",
		header,
		sep,
		...rows,
		"",
		"Use `timeline(anchor=ID)` for context or `get_observations(ids=[...])` for full details.",
	].join("\n");
}

function formatTimelineResults(results: TimelineResult[]): string {
	if (results.length === 0) {
		return "No timeline results found.";
	}

	const lines = results.map((r) => {
		const tool = r.tool_name ? ` [${r.tool_name}]` : "";
		const preview = r.narrative_preview ? `\n  ${r.narrative_preview}` : "";
		const sub = r.subtitle ? ` — ${r.subtitle}` : "";
		return `**#${r.id}** ${r.timestamp.slice(0, 16)} ${r.obs_type || r.type}${tool} — ${r.title}${sub}${preview}`;
	});

	return [
		`Timeline (${results.length} entries):`,
		"",
		...lines,
		"",
		"Use `get_observations(ids=[...])` for full details on specific entries.",
	].join("\n");
}

function formatFullResults(results: FullResult[]): string {
	if (results.length === 0) {
		return "No observations found for the given IDs.";
	}

	const entries = results.map((r) => {
		const parts = [
			`## #${r.id} — ${r.title}`,
			`**Type:** ${r.obs_type || r.type} | **Session:** ${r.session_id} | **Project:** ${r.project}`,
			`**Timestamp:** ${r.timestamp}`,
		];
		if (r.tool_name) parts.push(`**Tool:** ${r.tool_name}`);
		if (r.subtitle) parts.push(`**Subtitle:** ${r.subtitle}`);
		if (r.concepts.length > 0) parts.push(`**Concepts:** ${r.concepts.join(", ")}`);
		if (r.files_read.length > 0) parts.push(`**Files Read:** ${r.files_read.join(", ")}`);
		if (r.files_modified.length > 0) parts.push(`**Files Modified:** ${r.files_modified.join(", ")}`);
		if (r.facts.length > 0) {
			parts.push("", "**Facts:**");
			for (const fact of r.facts) {
				parts.push(`- ${fact}`);
			}
		}
		if (r.narrative) parts.push("", r.narrative);
		return parts.join("\n");
	});

	return entries.join("\n\n---\n\n");
}

// ─── Tool Registration ───────────────────────────────────────

export interface ToolCallbacks {
	onSearch: (params: any) => Promise<IndexResult[]>;
	onTimeline: (params: any) => Promise<TimelineResult[]>;
	onGetObservations: (params: any) => Promise<FullResult[]>;
	onSaveMemory: (params: any) => Promise<string>;
}

export function registerTools(pi: ExtensionAPI, callbacks: ToolCallbacks): void {
	// ─── search ───────────────────────────────────────────────
	pi.registerTool({
		name: "search",
		label: "Memory Search",
		description:
			"Step 1: Search memory. Returns compact index with IDs. " +
			"Params: query, limit, project, type, obs_type, dateStart, dateEnd, offset, orderBy",
		parameters: Type.Object({
			query: Type.String({ description: "Full-text search query (supports AND, OR, NOT)" }),
			limit: Type.Optional(Type.Number({ description: "Max results, default 20", default: 20 })),
			offset: Type.Optional(Type.Number({ description: "Skip first N results for pagination", default: 0 })),
			project: Type.Optional(Type.String({ description: "Filter by project slug" })),
			obs_type: Type.Optional(
				StringEnum(["observation", "summary", "prompt", "manual"] as const, {
					description: "Filter by record type",
				}),
			),
			dateStart: Type.Optional(Type.String({ description: "Filter by start date (YYYY-MM-DD)" })),
			dateEnd: Type.Optional(Type.String({ description: "Filter by end date (YYYY-MM-DD)" })),
			orderBy: Type.Optional(
				StringEnum(["date_desc", "date_asc", "relevance"] as const, {
					description: "Sort order (default: relevance for FTS)",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const results = await callbacks.onSearch(params);
				return {
					content: [{ type: "text", text: formatIndexResults(results) }],
					details: {},
				};
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Error searching: ${e.message}` }],
					isError: true,
					details: {},
				};
			}
		},
	});

	// ─── timeline ─────────────────────────────────────────────
	pi.registerTool({
		name: "timeline",
		label: "Memory Timeline",
		description:
			"Step 2: Get chronological context around a result. " +
			"Provide anchor (observation ID) OR query to find the anchor automatically.",
		parameters: Type.Object({
			anchor: Type.Optional(Type.String({ description: "Observation ID to center timeline around" })),
			query: Type.Optional(Type.String({ description: "Search query to find anchor automatically" })),
			depth_before: Type.Optional(Type.Number({ description: "Observations before anchor, default 3", default: 3 })),
			depth_after: Type.Optional(Type.Number({ description: "Observations after anchor, default 3", default: 3 })),
			project: Type.Optional(Type.String({ description: "Filter by project slug" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!params.anchor && !params.query) {
				return {
					content: [{ type: "text", text: "Provide either 'anchor' (observation ID) or 'query' to find the anchor." }],
					isError: true,
					details: {},
				};
			}

			try {
				const results = await callbacks.onTimeline(params);
				return {
					content: [{ type: "text", text: formatTimelineResults(results) }],
					details: {},
				};
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Error building timeline: ${e.message}` }],
					isError: true,
					details: {},
				};
			}
		},
	});

	// ─── get_observations ─────────────────────────────────────
	pi.registerTool({
		name: "get_observations",
		label: "Get Observations",
		description:
			"Step 3: Fetch full details for specific IDs. Always batch multiple IDs in a single call.",
		parameters: Type.Object({
			ids: Type.Array(Type.String(), {
				description: "Array of observation IDs to fetch (required)",
			}),
			orderBy: Type.Optional(
				StringEnum(["date_desc", "date_asc"] as const, {
					description: "Sort order",
				}),
			),
			limit: Type.Optional(Type.Number({ description: "Maximum observations to return" })),
			project: Type.Optional(Type.String({ description: "Filter by project slug" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!params.ids || params.ids.length === 0) {
				return {
					content: [{ type: "text", text: "Provide at least one observation ID." }],
					isError: true,
					details: {},
				};
			}

			try {
				const results = await callbacks.onGetObservations(params);
				return {
					content: [{ type: "text", text: formatFullResults(results) }],
					details: {},
				};
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Error fetching observations: ${e.message}` }],
					isError: true,
					details: {},
				};
			}
		},
	});

	// ─── save_memory ──────────────────────────────────────────
	pi.registerTool({
		name: "save_memory",
		label: "Save Memory",
		description:
			"Save important information to memory for future sessions. " +
			"Use for decisions, discoveries, or context that should be remembered.",
		parameters: Type.Object({
			text: Type.String({ description: "Content to remember (required)" }),
			title: Type.Optional(Type.String({ description: "Short title (auto-generated if omitted)" })),
			project: Type.Optional(Type.String({ description: "Project slug (defaults to current)" })),
			concepts: Type.Optional(
				Type.Array(Type.String(), {
					description: 'Concept tags, e.g. ["decision", "architecture"]',
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				const result = await callbacks.onSaveMemory(params);
				return {
					content: [{ type: "text", text: result }],
					details: {},
				};
			} catch (e: any) {
				return {
					content: [{ type: "text", text: `Error saving memory: ${e.message}` }],
					isError: true,
					details: {},
				};
			}
		},
	});
}
