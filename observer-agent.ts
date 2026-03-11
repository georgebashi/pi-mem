/**
 * Observer agent for pi-mem.
 * Spawns a headless pi sub-agent per tool execution to extract
 * structured observations from full tool output.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CODE_MODE } from "./mode-config.js";
import { parseObservation, type ParsedObservation } from "./xml-parser.js";
import type { PiMemConfig } from "./config.js";

const DEBUG_LOG_PATH = path.join(os.homedir(), ".pi-mem", "debug-observer.log");

function debugLog(msg: string) {
	try {
		fs.appendFileSync(DEBUG_LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
	} catch {}
}

// Tools that are pi-mem's own — skip to avoid meta-observations
const SKIP_TOOLS = new Set([
	"search",
	"timeline",
	"get_observations",
	"save_memory",
]);

const MIN_OUTPUT_LENGTH = 50;

// ─── Skip Logic ───────────────────────────────────────────────

/**
 * Check if a tool execution should be skipped (no observer call).
 */
export function shouldSkipObservation(
	toolName: string,
	output: string,
): boolean {
	if (SKIP_TOOLS.has(toolName)) return true;
	if (output.length < MIN_OUTPUT_LENGTH) return true;
	return false;
}

// ─── Prompt Building ──────────────────────────────────────────

/**
 * Build the observer system prompt from CODE_MODE config.
 */
function buildSystemPrompt(): string {
	const p = CODE_MODE.prompts;
	return [
		p.system_identity,
		"",
		p.observer_role,
		"",
		p.recording_focus,
		"",
		p.skip_guidance,
		"",
		p.type_guidance,
		"",
		p.concept_guidance,
		"",
		p.field_guidance,
		"",
		p.xml_format,
		"",
		p.footer,
	].join("\n");
}

/**
 * Build the user prompt for a single tool execution.
 */
export function buildObserverPrompt(
	toolName: string,
	input: Record<string, unknown>,
	output: string,
): string {
	return `<observed_from_primary_session>
  <what_happened>${toolName}</what_happened>
  <occurred_at>${new Date().toISOString()}</occurred_at>
  <parameters>${JSON.stringify(input, null, 2)}</parameters>
  <outcome>${output}</outcome>
</observed_from_primary_session>`;
}

// ─── Sub-Agent Spawn ──────────────────────────────────────────

function killProcess(proc: ChildProcess): void {
	try {
		proc.kill("SIGTERM");
	} catch {}
	setTimeout(() => {
		try {
			proc.kill("SIGKILL");
		} catch {}
	}, 2000);
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
	return new Promise((resolve) => {
		const proc = spawn(
			"pi",
			[
				"--mode", "json",
				"-p",
				"--no-session",
				"--no-tools",
				"--system-prompt", systemPrompt,
				"--model", model,
				"--thinking", thinkingLevel,
				prompt,
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, PI_MEM_SUB_AGENT: "1" },
			},
		);

		let buffer = "";
		let lastAssistantText = "";
		let stderr = "";

		const timeout = setTimeout(() => {
			killProcess(proc);
			resolve({ ok: false, error: "Observer timeout (60s)" });
		}, 60_000);

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line);
				if (
					event.type === "message_end" &&
					event.message?.role === "assistant"
				) {
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
			if (buffer.trim()) processLine(buffer);

			if (lastAssistantText) {
				resolve({ ok: true, response: lastAssistantText });
			} else if (code !== 0) {
				resolve({
					ok: false,
					error: `Sub-agent failed (exit ${code}): ${stderr.trim().slice(0, 500) || "(no output)"}`,
				});
			} else {
				resolve({ ok: false, error: "Sub-agent returned no response" });
			}
		});

		proc.on("error", (err) => {
			clearTimeout(timeout);
			resolve({ ok: false, error: `Failed to spawn pi: ${err.message}` });
		});
	});
}

// ─── Main Entry Point ─────────────────────────────────────────

export interface ObserverContext {
	/** Current session model */
	model: any;
	/** Current session thinking level */
	thinkingLevel: string;
}

/**
 * Extract a structured observation from a tool execution.
 * Spawns observer LLM, parses XML output.
 * Returns null if extraction fails or is skipped.
 */
export async function extractObservation(
	toolName: string,
	input: Record<string, unknown>,
	output: string,
	config: PiMemConfig,
	context: ObserverContext,
): Promise<ParsedObservation | null> {
	// Skip logic
	if (shouldSkipObservation(toolName, output)) {
		return null;
	}

	// Resolve model: observerModel → summaryModel → session model
	const model =
		config.observerModel ||
		config.summaryModel ||
		(context.model
			? `${context.model.provider}/${context.model.id}`
			: undefined);

	if (!model) {
		debugLog("No model available for observer extraction");
		return null;
	}

	const thinkingLevel = config.thinkingLevel || context.thinkingLevel || "none";

	const systemPrompt = buildSystemPrompt();
	const userPrompt = buildObserverPrompt(toolName, input, output);

	debugLog(
		`Extracting observation: ${toolName} (output: ${output.length} chars, model: ${model})`,
	);

	const result = await runSubAgent(
		userPrompt,
		systemPrompt,
		model,
		thinkingLevel,
	);

	if (!result.ok) {
		debugLog(`Observer failed: ${result.error}`);
		return null;
	}

	debugLog(
		`Observer response: ${result.response.length} chars`,
	);

	const parsed = parseObservation(result.response);
	if (!parsed) {
		debugLog("Observer returned no parseable observation XML");
		return null;
	}

	debugLog(`Extracted: [${parsed.type}] ${parsed.title}`);
	return parsed;
}
