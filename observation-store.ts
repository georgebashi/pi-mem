/**
 * Observation store for pi-mem using LanceDB.
 *
 * Unified table storing structured observations, prompts, summaries, and manual saves.
 * - FTS index on `narrative` column for keyword search
 * - Nullable `vector` column for semantic search (only summaries + manual saves)
 * - Scalar indexes on metadata columns for efficient filtering
 *
 * Schema v2: Structured observation fields (title, subtitle, facts, narrative,
 * concepts, files_read, files_modified) replace the old raw `text` column.
 * On first run, any existing old-schema table is dropped and recreated.
 *
 * Embeddings are computed via a raw fetch() to an OpenAI-compatible
 * /v1/embeddings endpoint, using pi's provider system for credentials.
 * The embedding model and dimensions are configurable via config.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PI_MEM_DIR } from "./config.js";
import type { PiMemConfig } from "./config.js";
import type { ValidObsType } from "./mode-config.js";

// ─── Types ────────────────────────────────────────────────────

export type RowType = "observation" | "prompt" | "summary" | "manual";

export interface ObservationRow {
	id: string;
	session_id: string;
	project: string;
	type: RowType;
	obs_type: string;       // ValidObsType or "" for non-observation rows
	timestamp: string;
	tool_name: string;
	title: string;
	subtitle: string;
	facts: string;          // JSON array of strings
	narrative: string;      // Full context / searchable text
	concepts: string;       // JSON array of ValidConcept strings
	files_read: string;     // JSON array of file paths
	files_modified: string; // JSON array of file paths
	vector: number[];
}

/** Compact index result (search layer 1) */
export interface IndexResult {
	id: string;
	session_id: string;
	project: string;
	type: string;
	obs_type: string;
	timestamp: string;
	tool_name: string;
	title: string;
	subtitle: string;
}

/** Medium-detail result (timeline layer 2) */
export interface TimelineResult extends IndexResult {
	narrative_preview: string;
}

/** Full-detail result (get_observations layer 3) */
export interface FullResult {
	id: string;
	session_id: string;
	project: string;
	type: string;
	obs_type: string;
	timestamp: string;
	tool_name: string;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	files_read: string[];
	files_modified: string[];
}

export interface ObservationStore {
	available: boolean;
	db: any;
	table: any;
	/** Compute embeddings for text. null if no embedding provider configured. */
	embed: ((text: string) => Promise<number[]>) | null;
	/** Embedding dimensions. Used for zero-vector placeholder. */
	embeddingDims: number;
}

export interface StoreContext {
	/** Pi model registry for resolving provider credentials */
	modelRegistry: any;
}

// ─── Constants ────────────────────────────────────────────────

const LANCEDB_DIR = path.join(PI_MEM_DIR, "lancedb");
const TABLE_NAME = "observations_v2";
const OLD_TABLE_NAME = "observations";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMS = 1536;

const INDEX_COLUMNS = [
	"id", "session_id", "project", "type", "obs_type",
	"timestamp", "tool_name", "title", "subtitle",
];

function zeroVector(dims: number): number[] {
	return new Array(dims).fill(0);
}

// ─── Embedding ────────────────────────────────────────────────

async function callEmbeddingsAPI(
	baseUrl: string,
	apiKey: string,
	model: string,
	input: string[],
): Promise<number[][]> {
	const url = baseUrl.replace(/\/+$/, "");
	const embeddingsUrl = url.endsWith("/v1")
		? `${url}/embeddings`
		: `${url}/v1/embeddings`;

	const response = await fetch(embeddingsUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ model, input }),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Embeddings API error ${response.status}: ${text.slice(0, 200)}`);
	}

	const json = (await response.json()) as any;
	return json.data.map((d: any) => d.embedding);
}

async function createEmbedFunction(
	config: PiMemConfig,
	context: StoreContext,
): Promise<{ embed: (text: string) => Promise<number[]>; dims: number } | null> {
	const providerName = config.embeddingProvider;
	if (!providerName) return null;

	const registry = context.modelRegistry;
	const models = registry.getAvailable();
	const providerModel = models.find((m: any) => m.provider === providerName);
	if (!providerModel) return null;

	const baseUrl = providerModel.baseUrl;
	const apiKey = await registry.getApiKeyForProvider(providerName);
	if (!baseUrl || !apiKey) return null;

	const embeddingModel = config.embeddingModel || DEFAULT_EMBEDDING_MODEL;
	const dims = config.embeddingDims || DEFAULT_EMBEDDING_DIMS;

	const embed = async (text: string): Promise<number[]> => {
		const results = await callEmbeddingsAPI(baseUrl, apiKey, embeddingModel, [text]);
		return results[0];
	};

	return { embed, dims };
}

// ─── Store Init ───────────────────────────────────────────────

/**
 * Initialize the observation store.
 * Drops old schema tables and creates/opens the v2 structured table.
 */
export async function initStore(
	config: PiMemConfig,
	context?: StoreContext,
): Promise<ObservationStore | null> {
	try {
		const lancedb = await import("@lancedb/lancedb");

		let embed: ((text: string) => Promise<number[]>) | null = null;
		let dims = config.embeddingDims || DEFAULT_EMBEDDING_DIMS;

		if (context && config.embeddingProvider) {
			try {
				const result = await createEmbedFunction(config, context);
				if (result) {
					embed = result.embed;
					dims = result.dims;
				}
			} catch {
				// Graceful degradation — no embeddings
			}
		}

		const db = await lancedb.connect(LANCEDB_DIR);

		// Drop old table if it exists (clean break)
		try {
			await db.dropTable(OLD_TABLE_NAME);
		} catch {
			// Doesn't exist — fine
		}

		let table: any;
		try {
			table = await db.openTable(TABLE_NAME);
		} catch {
			table = null; // Will be created on first write
		}

		return { available: true, db, table, embed, embeddingDims: dims };
	} catch {
		return null;
	}
}

// ─── Row Helpers ──────────────────────────────────────────────

function makeId(): string {
	return crypto.randomUUID().slice(0, 8);
}

function makeRow(
	fields: Omit<ObservationRow, "id"> & { id?: string },
): ObservationRow {
	return {
		id: fields.id ?? makeId(),
		session_id: fields.session_id,
		project: fields.project,
		type: fields.type,
		obs_type: fields.obs_type,
		timestamp: fields.timestamp,
		tool_name: fields.tool_name,
		title: fields.title,
		subtitle: fields.subtitle,
		facts: fields.facts,
		narrative: fields.narrative,
		concepts: fields.concepts,
		files_read: fields.files_read,
		files_modified: fields.files_modified,
		vector: fields.vector,
	};
}

async function ensureTable(store: ObservationStore, row: ObservationRow): Promise<void> {
	if (!store.table) {
		store.table = await store.db.createTable(TABLE_NAME, [row]);
	} else {
		await store.table.add([row]);
	}
}

// ─── JSON Helpers ─────────────────────────────────────────────

function toJsonArray(arr: string[]): string {
	return JSON.stringify(arr);
}

function fromJsonArray(json: string | null | undefined): string[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

// ─── Write Functions ──────────────────────────────────────────

/**
 * Write a structured observation row.
 */
export async function addObservation(
	store: ObservationStore,
	fields: {
		session_id: string;
		project: string;
		timestamp: string;
		tool_name: string;
		obs_type: string;
		title: string;
		subtitle: string;
		facts: string[];
		narrative: string;
		concepts: string[];
		files_read: string[];
		files_modified: string[];
	},
): Promise<void> {
	if (!store.available || !store.db) return;

	const row = makeRow({
		...fields,
		type: "observation",
		facts: toJsonArray(fields.facts),
		concepts: toJsonArray(fields.concepts),
		files_read: toJsonArray(fields.files_read),
		files_modified: toJsonArray(fields.files_modified),
		vector: zeroVector(store.embeddingDims),
	});

	try {
		await ensureTable(store, row);
	} catch (e) {
		console.error("[pi-mem] Failed to write observation:", e);
	}
}

/**
 * Write a user prompt row.
 */
export async function addPrompt(
	store: ObservationStore,
	fields: {
		session_id: string;
		project: string;
		timestamp: string;
		text: string;
	},
): Promise<void> {
	if (!store.available || !store.db) return;

	const row = makeRow({
		session_id: fields.session_id,
		project: fields.project,
		type: "prompt",
		obs_type: "",
		timestamp: fields.timestamp,
		tool_name: "",
		title: fields.text.slice(0, 80),
		subtitle: "",
		facts: "[]",
		narrative: fields.text,
		concepts: "[]",
		files_read: "[]",
		files_modified: "[]",
		vector: zeroVector(store.embeddingDims),
	});

	try {
		await ensureTable(store, row);
	} catch (e) {
		console.error("[pi-mem] Failed to write prompt:", e);
	}
}

/**
 * Write a session summary row. Computes embedding if available.
 */
export async function addSummary(
	store: ObservationStore,
	fields: {
		session_id: string;
		project: string;
		timestamp: string;
		title: string;
		narrative: string;
		concepts: string[];
		files_read: string[];
		files_modified: string[];
	},
): Promise<string | null> {
	if (!store.available || !store.db) return null;

	let vector: number[] = zeroVector(store.embeddingDims);
	if (store.embed) {
		try {
			vector = await store.embed(fields.narrative);
		} catch {
			// Graceful degradation
		}
	}

	const row = makeRow({
		session_id: fields.session_id,
		project: fields.project,
		type: "summary",
		obs_type: "",
		timestamp: fields.timestamp,
		tool_name: "",
		title: fields.title,
		subtitle: "",
		facts: "[]",
		narrative: fields.narrative,
		concepts: toJsonArray(fields.concepts),
		files_read: toJsonArray(fields.files_read),
		files_modified: toJsonArray(fields.files_modified),
		vector,
	});

	try {
		await ensureTable(store, row);
		return row.id;
	} catch (e) {
		console.error("[pi-mem] Failed to write summary:", e);
		return null;
	}
}

/**
 * Write a manual memory row. Computes embedding if available.
 */
export async function addManualMemory(
	store: ObservationStore,
	fields: {
		session_id: string;
		project: string;
		timestamp: string;
		title: string;
		text: string;
		concepts: string;
	},
): Promise<void> {
	if (!store.available || !store.db) return;

	let vector: number[] = zeroVector(store.embeddingDims);
	if (store.embed) {
		try {
			vector = await store.embed(fields.text);
		} catch {
			// Graceful degradation
		}
	}

	// Parse concepts from comma-separated string
	const conceptsList = fields.concepts
		? fields.concepts.split(",").map((c) => c.trim()).filter(Boolean)
		: [];

	const row = makeRow({
		session_id: fields.session_id,
		project: fields.project,
		type: "manual",
		obs_type: "",
		timestamp: fields.timestamp,
		tool_name: "",
		title: fields.title,
		subtitle: "",
		facts: "[]",
		narrative: fields.text,
		concepts: toJsonArray(conceptsList),
		files_read: "[]",
		files_modified: "[]",
		vector,
	});

	try {
		await ensureTable(store, row);
	} catch (e) {
		console.error("[pi-mem] Failed to write manual memory:", e);
	}
}

// ─── Read Functions ───────────────────────────────────────────

/**
 * Get all observations for a session, ordered by timestamp ASC.
 */
export async function getSessionObservations(
	store: ObservationStore,
	sessionId: string,
): Promise<FullResult[]> {
	if (!store.available || !store.table) return [];

	try {
		const rows = await store.table
			.query()
			.where(`session_id = '${sessionId}' AND type = 'observation'`)
			.select([
				"id", "session_id", "project", "type", "obs_type", "timestamp",
				"tool_name", "title", "subtitle", "facts", "narrative",
				"concepts", "files_read", "files_modified",
			])
			.toArray();

		rows.sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));

		return rows.map(rowToFullResult);
	} catch {
		return [];
	}
}

// ─── Search Functions ─────────────────────────────────────────

export interface SearchFilters {
	project?: string;
	obs_type?: string;
	dateStart?: string;
	dateEnd?: string;
}

function buildWhereClause(filters: SearchFilters, excludePrompts = false): string {
	const parts: string[] = [];

	if (filters.project) {
		parts.push(`project = '${filters.project}'`);
	}
	if (filters.obs_type) {
		parts.push(`type = '${filters.obs_type}'`);
	} else if (excludePrompts) {
		parts.push(`type != 'prompt'`);
	}
	if (filters.dateStart) {
		parts.push(`timestamp >= '${filters.dateStart}'`);
	}
	if (filters.dateEnd) {
		parts.push(`timestamp <= '${filters.dateEnd}T23:59:59'`);
	}

	return parts.length > 0 ? parts.join(" AND ") : "";
}

/**
 * FTS search on the narrative column with optional filters.
 */
export async function ftsSearch(
	store: ObservationStore,
	query: string,
	filters: SearchFilters = {},
	limit = 20,
	offset = 0,
): Promise<IndexResult[]> {
	if (!store.available || !store.table) return [];

	try {
		let search = store.table.search(query, "fts", ["narrative"]).limit(limit + offset);

		const where = buildWhereClause(filters, true);
		if (where) {
			search = search.where(where);
		}

		search = search.select(INDEX_COLUMNS);

		const rows = await search.toArray();
		const sliced = rows.slice(offset, offset + limit);

		return sliced.map((r: any) => ({
			id: r.id,
			session_id: r.session_id,
			project: r.project,
			type: r.type,
			obs_type: r.obs_type,
			timestamp: r.timestamp,
			tool_name: r.tool_name,
			title: r.title,
			subtitle: r.subtitle,
		}));
	} catch {
		return [];
	}
}

// ─── Hybrid Search ───────────────────────────────────────────

interface RankedItem {
	id: string;
	result: IndexResult;
}

/**
 * Reciprocal Rank Fusion: merge multiple ranked lists into one.
 * Each item's score = sum of weight / (k + rank + 1) across lists.
 * Items appearing in multiple lists get boosted naturally.
 */
function reciprocalRankFusion(
	lists: RankedItem[][],
	weights: number[] = [],
	k = 60,
): IndexResult[] {
	const scores = new Map<string, { result: IndexResult; score: number }>();

	for (let listIdx = 0; listIdx < lists.length; listIdx++) {
		const list = lists[listIdx];
		if (!list) continue;
		const weight = weights[listIdx] ?? 1.0;

		for (let rank = 0; rank < list.length; rank++) {
			const item = list[rank];
			if (!item) continue;
			const contribution = weight / (k + rank + 1);
			const existing = scores.get(item.id);

			if (existing) {
				existing.score += contribution;
			} else {
				scores.set(item.id, { result: item.result, score: contribution });
			}
		}
	}

	return Array.from(scores.values())
		.sort((a, b) => b.score - a.score)
		.map((e) => e.result);
}

/**
 * Hybrid search: runs FTS and vector search in parallel, merges with RRF.
 * FTS searches all non-prompt rows; vector searches summaries + manual saves.
 * Falls back to FTS-only if embeddings are unavailable.
 */
export async function hybridSearch(
	store: ObservationStore,
	query: string,
	filters: SearchFilters = {},
	limit = 20,
	offset = 0,
): Promise<IndexResult[]> {
	if (!store.available || !store.table) return [];

	// Run FTS and vector search in parallel
	const candidateLimit = Math.max(limit * 3, 40);

	const ftsPromise = ftsSearch(store, query, filters, candidateLimit, 0);

	const vecPromise = (store.embed
		? vectorSearchForIndex(store, query, filters.project, candidateLimit)
		: Promise.resolve([] as IndexResult[])
	);

	const [ftsResults, vecResults] = await Promise.all([ftsPromise, vecPromise]);

	// If no vector results, just return FTS directly
	if (vecResults.length === 0) {
		return ftsResults.slice(offset, offset + limit);
	}

	// Build ranked lists for RRF
	const ftsList: RankedItem[] = ftsResults.map((r) => ({ id: r.id, result: r }));
	const vecList: RankedItem[] = vecResults.map((r) => ({ id: r.id, result: r }));

	// FTS gets higher weight (2x) since it covers all row types
	const fused = reciprocalRankFusion([ftsList, vecList], [2.0, 1.0]);

	return fused.slice(offset, offset + limit);
}

/**
 * Vector search that returns IndexResult (not FullResult).
 * Searches summaries + manual saves only (they have real embeddings).
 */
async function vectorSearchForIndex(
	store: ObservationStore,
	queryText: string,
	project?: string,
	limit = 20,
): Promise<IndexResult[]> {
	if (!store.available || !store.table || !store.embed) return [];

	try {
		const queryVector = await store.embed(queryText);

		let search = store.table.vectorSearch(queryVector).limit(limit);

		const whereParts = ["type IN ('summary', 'manual')"];
		if (project) {
			whereParts.push(`project = '${project}'`);
		}
		search = search.where(whereParts.join(" AND "));

		search = search.select(INDEX_COLUMNS);

		const rows = await search.toArray();

		return rows.map((r: any) => ({
			id: r.id,
			session_id: r.session_id,
			project: r.project,
			type: r.type,
			obs_type: r.obs_type,
			timestamp: r.timestamp,
			tool_name: r.tool_name,
			title: r.title,
			subtitle: r.subtitle,
		}));
	} catch {
		return [];
	}
}

/**
 * Timeline search: find observations around an anchor point.
 */
export async function timelineSearch(
	store: ObservationStore,
	options: {
		anchorId?: string;
		query?: string;
		depthBefore?: number;
		depthAfter?: number;
		project?: string;
	},
): Promise<TimelineResult[]> {
	if (!store.available || !store.table) return [];

	const depthBefore = options.depthBefore ?? 3;
	const depthAfter = options.depthAfter ?? 3;

	try {
		// Find anchor
		let anchorTimestamp: string;

		if (options.anchorId) {
			const anchor = await store.table
				.query()
				.where(`id = '${options.anchorId}'`)
				.select(["timestamp", "session_id"])
				.toArray();
			if (anchor.length === 0) return [];
			anchorTimestamp = anchor[0].timestamp;
		} else if (options.query) {
			const ftsResults = await ftsSearch(store, options.query, { project: options.project }, 1);
			if (ftsResults.length === 0) return [];
			const anchor = await store.table
				.query()
				.where(`id = '${ftsResults[0].id}'`)
				.select(["timestamp", "session_id"])
				.toArray();
			if (anchor.length === 0) return [];
			anchorTimestamp = anchor[0].timestamp;
		} else {
			return [];
		}

		const timelineSelect = [...INDEX_COLUMNS, "narrative"];

		// Query before
		let beforeWhere = `timestamp < '${anchorTimestamp}'`;
		if (options.project) beforeWhere += ` AND project = '${options.project}'`;

		const before = await store.table
			.query()
			.where(beforeWhere)
			.select(timelineSelect)
			.toArray();

		before.sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));
		const beforeSlice = before.slice(0, depthBefore).reverse();

		// Query anchor
		const anchorRows = await store.table
			.query()
			.where(`timestamp = '${anchorTimestamp}'`)
			.select(timelineSelect)
			.toArray();

		// Query after
		let afterWhere = `timestamp > '${anchorTimestamp}'`;
		if (options.project) afterWhere += ` AND project = '${options.project}'`;

		const after = await store.table
			.query()
			.where(afterWhere)
			.select(timelineSelect)
			.toArray();

		after.sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
		const afterSlice = after.slice(0, depthAfter);

		const combined = [...beforeSlice, ...anchorRows, ...afterSlice];

		return combined.map((r: any) => ({
			id: r.id,
			session_id: r.session_id,
			project: r.project,
			type: r.type,
			obs_type: r.obs_type,
			timestamp: r.timestamp,
			tool_name: r.tool_name,
			title: r.title,
			subtitle: r.subtitle,
			narrative_preview: r.narrative?.slice(0, 200) ?? "",
		}));
	} catch {
		return [];
	}
}

/**
 * Get full observation details by IDs.
 */
export async function getObservationsByIds(
	store: ObservationStore,
	ids: string[],
): Promise<FullResult[]> {
	if (!store.available || !store.table || ids.length === 0) return [];

	try {
		const idList = ids.map((id) => `'${id}'`).join(", ");
		const rows = await store.table
			.query()
			.where(`id IN (${idList})`)
			.select([
				"id", "session_id", "project", "type", "obs_type", "timestamp",
				"tool_name", "title", "subtitle", "facts", "narrative",
				"concepts", "files_read", "files_modified",
			])
			.toArray();

		return rows.map(rowToFullResult);
	} catch {
		return [];
	}
}

/**
 * Get recent summaries for a project.
 */
export async function getRecentSummaries(
	store: ObservationStore,
	project: string,
	limit = 10,
): Promise<IndexResult[]> {
	if (!store.available || !store.table) return [];

	try {
		const rows = await store.table
			.query()
			.where(`project = '${project}' AND type = 'summary'`)
			.select(INDEX_COLUMNS)
			.toArray();

		rows.sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));

		return rows.slice(0, limit).map((r: any) => ({
			id: r.id,
			session_id: r.session_id,
			project: r.project,
			type: r.type,
			obs_type: r.obs_type,
			timestamp: r.timestamp,
			tool_name: r.tool_name,
			title: r.title,
			subtitle: r.subtitle,
		}));
	} catch {
		return [];
	}
}

/**
 * Semantic vector search on summaries and manual saves.
 */
export async function semanticSearch(
	store: ObservationStore,
	queryText: string,
	project?: string,
	limit = 3,
): Promise<FullResult[]> {
	if (!store.available || !store.table || !store.embed) return [];

	try {
		const queryVector = await store.embed(queryText);

		let search = store.table.vectorSearch(queryVector).limit(limit);

		const whereParts = ["type IN ('summary', 'manual')"];
		if (project) {
			whereParts.push(`project = '${project}'`);
		}
		search = search.where(whereParts.join(" AND "));

		search = search.select([
			"id", "session_id", "project", "type", "obs_type", "timestamp",
			"tool_name", "title", "subtitle", "facts", "narrative",
			"concepts", "files_read", "files_modified", "_distance",
		]);

		const rows = await search.toArray();
		return rows.map(rowToFullResult);
	} catch {
		return [];
	}
}

// ─── Row Mapping Helper ──────────────────────────────────────

function rowToFullResult(r: any): FullResult {
	return {
		id: r.id,
		session_id: r.session_id,
		project: r.project,
		type: r.type,
		obs_type: r.obs_type,
		timestamp: r.timestamp,
		tool_name: r.tool_name,
		title: r.title,
		subtitle: r.subtitle,
		facts: fromJsonArray(r.facts),
		narrative: r.narrative,
		concepts: fromJsonArray(r.concepts),
		files_read: fromJsonArray(r.files_read),
		files_modified: fromJsonArray(r.files_modified),
	};
}

// ─── CRUD Operations ──────────────────────────────────────────

/**
 * Delete a single observation by ID.
 */
export async function deleteObservation(
	store: ObservationStore,
	id: string,
): Promise<void> {
	if (!store.available || !store.table) return;

	try {
		await store.table.delete(`id = '${id}'`);
	} catch {
		// Non-fatal
	}
}

/**
 * Get the type field for a row by ID, or null if not found.
 */
export async function getObservationType(
	store: ObservationStore,
	id: string,
): Promise<string | null> {
	if (!store.available || !store.table) return null;

	try {
		const rows = await store.table
			.query()
			.where(`id = '${id}'`)
			.select(["type"])
			.toArray();
		return rows[0]?.type ?? null;
	} catch {
		return null;
	}
}

/**
 * Update observation fields by ID. Supports title, narrative, and concepts.
 * When narrative changes on a summary/manual row, recomputes the embedding vector.
 */
export async function updateObservation(
	store: ObservationStore,
	id: string,
	fields: { title?: string; narrative?: string; concepts?: string },
): Promise<void> {
	if (!store.available || !store.table) return;

	try {
		const values: Record<string, any> = {};
		if (fields.title !== undefined) values.title = fields.title;
		if (fields.narrative !== undefined) values.narrative = fields.narrative;
		if (fields.concepts !== undefined) values.concepts = fields.concepts;

		if (Object.keys(values).length === 0) return;

		// Re-embed if narrative changed on a summary/manual row
		if (fields.narrative !== undefined && store.embed) {
			const rowType = await getObservationType(store, id);
			if (rowType === "summary" || rowType === "manual") {
				try {
					values.vector = await store.embed(fields.narrative);
				} catch {
					// Graceful degradation — keep old vector
				}
			}
		}

		await store.table.update({ where: `id = '${id}'`, values });
	} catch {
		// Non-fatal
	}
}

/**
 * Options for listing observations.
 */
export interface ListOptions {
	project?: string;
	type?: string;
	limit?: number;
	offset?: number;
	order?: "asc" | "desc";
}

/**
 * List observations with pagination and filtering.
 */
export async function listObservations(
	store: ObservationStore,
	options: ListOptions = {},
): Promise<IndexResult[]> {
	if (!store.available || !store.table) return [];

	try {
		const whereParts: string[] = [];
		if (options.project) {
			whereParts.push(`project = '${options.project}'`);
		}
		if (options.type) {
			whereParts.push(`type = '${options.type}'`);
		}

		let query = store.table.query();
		if (whereParts.length > 0) {
			query = query.where(whereParts.join(" AND "));
		}
		query = query.select(INDEX_COLUMNS);

		const rows = await query.toArray();

		// Sort by timestamp
		const desc = options.order !== "asc";
		rows.sort((a: any, b: any) =>
			desc
				? b.timestamp.localeCompare(a.timestamp)
				: a.timestamp.localeCompare(b.timestamp),
		);

		// Apply offset/limit
		const offset = options.offset ?? 0;
		const limit = options.limit ?? 100;
		const sliced = rows.slice(offset, offset + limit);

		return sliced.map((r: any) => ({
			id: r.id,
			session_id: r.session_id,
			project: r.project,
			type: r.type,
			obs_type: r.obs_type,
			timestamp: r.timestamp,
			tool_name: r.tool_name,
			title: r.title,
			subtitle: r.subtitle,
		}));
	} catch {
		return [];
	}
}

/**
 * Count observations matching filters.
 */
export async function countObservations(
	store: ObservationStore,
	options: { project?: string; type?: string } = {},
): Promise<number> {
	if (!store.available || !store.table) return 0;

	try {
		const whereParts: string[] = [];
		if (options.project) {
			whereParts.push(`project = '${options.project}'`);
		}
		if (options.type) {
			whereParts.push(`type = '${options.type}'`);
		}

		let query = store.table.query();
		if (whereParts.length > 0) {
			query = query.where(whereParts.join(" AND "));
		}
		query = query.select(["id"]);

		const rows = await query.toArray();
		return rows.length;
	} catch {
		return 0;
	}
}

/**
 * Get a single observation by ID with full details.
 */
export async function getObservationById(
	store: ObservationStore,
	id: string,
): Promise<FullResult | null> {
	const results = await getObservationsByIds(store, [id]);
	return results[0] ?? null;
}

// ─── Session Summary Management ───────────────────────────────

export async function deleteSessionSummaries(
	store: ObservationStore,
	sessionId: string,
	excludeId: string,
): Promise<void> {
	if (!store.available || !store.table) return;

	try {
		await store.table.delete(`session_id = '${sessionId}' AND type = 'summary' AND id != '${excludeId}'`);
	} catch {
		// Non-fatal
	}
}

// ─── Maintenance ──────────────────────────────────────────────

export async function compactAndReindex(store: ObservationStore): Promise<void> {
	if (!store.available || !store.table) return;

	try {
		await store.table.optimize({ cleanupOlderThan: new Date() });
	} catch {
		// Non-fatal
	}

	try {
		const lancedb = await import("@lancedb/lancedb");
		await store.table.createIndex("narrative", { config: lancedb.Index.fts(), replace: true });
	} catch {
		// Non-fatal
	}

	try {
		await store.table.createIndex("project", { replace: true });
		await store.table.createIndex("session_id", { replace: true });
		await store.table.createIndex("timestamp", { replace: true });
		await store.table.createIndex("type", { replace: true });
	} catch {
		// Non-fatal
	}
}
