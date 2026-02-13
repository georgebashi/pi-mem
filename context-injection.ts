/**
 * Context injection for pi-mem.
 * Queries LanceDB for recent summaries, prompt-aware semantic search,
 * and injects 3-layer workflow guidance.
 */

import type { PiMemConfig } from "./config.js";
import {
	getRecentSummaries,
	semanticSearch,
	type ObservationStore,
} from "./observation-store.js";

/**
 * Estimate token count from text (~4 chars per token).
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

const WORKFLOW_GUIDANCE = `### Memory Search Tools

3-LAYER WORKFLOW (ALWAYS FOLLOW):
1. search(query) → Get index with IDs (~50-100 tokens/result)
2. timeline(anchor=ID) → Get context around interesting results
3. get_observations([IDs]) → Fetch full details ONLY for filtered IDs
NEVER fetch full details without filtering first. 10x token savings.`;

/**
 * Build the injected context for before_agent_start.
 * Returns null if no context is available.
 */
export async function buildInjectedContext(
	store: ObservationStore | null,
	projectSlug: string,
	config: PiMemConfig,
	userPrompt?: string,
): Promise<string | null> {
	if (!config.autoInject) return null;

	let budget = config.tokenBudget;
	const parts: string[] = [];

	// 1. Recent summaries index (highest priority)
	if (store?.available) {
		try {
			const summaries = await getRecentSummaries(store, projectSlug, config.indexSize);
			if (summaries.length > 0) {
				const indexSection =
					`## Project Memory (${projectSlug})\n\n` +
					summaries
						.map((s) => `- ${s.timestamp.slice(0, 10)} [${s.session_id}]: ${s.title}`)
						.join("\n");
				const tokens = estimateTokens(indexSection);
				if (tokens <= budget) {
					parts.push(indexSection);
					budget -= tokens;
				}
			}
		} catch {
			// Graceful degradation
		}
	}

	// 2. Prompt-aware semantic search results (if available)
	if (store?.available && store.embed && userPrompt && budget > 200) {
		try {
			const results = await semanticSearch(store, userPrompt, projectSlug, 2);
			for (const result of results) {
				const maxChars = budget * 4;
				const snippet = `### Relevant: ${result.timestamp.slice(0, 10)} [${result.session_id}]\n${result.narrative.slice(0, maxChars)}`;
				const tokens = estimateTokens(snippet);
				if (tokens > budget) break;
				parts.push(snippet);
				budget -= tokens;
			}
		} catch {
			// Graceful degradation
		}
	}

	// 3. Workflow guidance (always included if there's budget)
	const guidanceTokens = estimateTokens(WORKFLOW_GUIDANCE);
	if (guidanceTokens <= budget) {
		parts.push(WORKFLOW_GUIDANCE);
		budget -= guidanceTokens;
	}

	if (parts.length === 0) return null;

	return parts.join("\n\n");
}
