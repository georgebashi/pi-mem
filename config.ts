/**
 * Configuration management for pi-mem.
 * Loads from ~/.pi/agent/pi-mem.json with fallback to ~/.pi-mem/config.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface PiMemConfig {
	enabled: boolean;
	autoInject: boolean;
	maxObservationLength: number;
	/** Model for observation extraction (e.g. "provider/model-id"). Falls back to summaryModel → session model. */
	observerModel?: string;
	/** Model for summarization (e.g. "provider/model-id"). Defaults to the current session model. */
	summaryModel?: string;
	/** Thinking level for summarization (e.g. "medium"). Defaults to current session thinking level. */
	thinkingLevel?: string;
	indexSize: number;
	tokenBudget: number;
	/** Pi provider to use for embeddings (e.g. "openai"). Must support OpenAI-compatible /v1/embeddings. */
	embeddingProvider?: string;
	/** Embedding model name (default: "text-embedding-3-small"). */
	embeddingModel?: string;
	/** Embedding vector dimensions (default: 1536). Must match the model's output dimensions. */
	embeddingDims?: number;
}

const DEFAULTS: PiMemConfig = {
	enabled: true,
	autoInject: true,
	maxObservationLength: 4000,
	indexSize: 10,
	tokenBudget: 2000,
};

export const PI_MEM_DIR = path.join(os.homedir(), ".pi-mem");

const CONFIG_PATHS = [
	path.join(os.homedir(), ".pi", "agent", "pi-mem.json"),
	path.join(PI_MEM_DIR, "config.json"),
];

export function loadConfig(): PiMemConfig {
	for (const configPath of CONFIG_PATHS) {
		try {
			if (fs.existsSync(configPath)) {
				const raw = fs.readFileSync(configPath, "utf-8");
				const userConfig = JSON.parse(raw);
				// Support both "model" and "summaryModel" keys
				if (userConfig.model && !userConfig.summaryModel) {
					userConfig.summaryModel = userConfig.model;
				}
				return { ...DEFAULTS, ...userConfig };
			}
		} catch {
			// Ignore parse errors, try next
		}
	}

	return { ...DEFAULTS };
}
