/**
 * Test checkpoint summarization logic.
 * Run with: bun test-checkpoint-summarization.ts
 *
 * Tests:
 * 1. addSummary returns the row ID
 * 2. deleteSessionSummaries removes old summaries but keeps the excluded one
 * 3. Write-then-delete workflow leaves exactly one summary
 * 4. deleteSessionSummaries is safe when no old summaries exist
 * 5. deleteSessionSummaries handles missing store gracefully
 */

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const TEST_DIR = path.join(os.tmpdir(), `pi-mem-test-${Date.now()}`);
fs.mkdirSync(TEST_DIR, { recursive: true });

const lancedb = await import("@lancedb/lancedb");
const EMBEDDING_DIMS = 1536;
const ZERO_VECTOR = new Array(EMBEDDING_DIMS).fill(0);
const db = await lancedb.connect(path.join(TEST_DIR, "lancedb"));

import {
	addSummary,
	deleteSessionSummaries,
	type ObservationStore,
} from "./observation-store.ts";

async function createTestStore(): Promise<ObservationStore> {
	const table = await db.createTable("test_" + Date.now(), [
		{
			id: "init",
			session_id: "init",
			project: "test",
			type: "observation",
			obs_type: "",
			timestamp: new Date().toISOString(),
			tool_name: "test",
			title: "init",
			subtitle: "",
			facts: "[]",
			narrative: "init row",
			concepts: "[]",
			files_read: "[]",
			files_modified: "[]",
			vector: ZERO_VECTOR,
		},
	]);
	return { available: true, db, table, embed: null, embeddingDims: EMBEDDING_DIMS };
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
	if (condition) { console.log(`  ✓ ${label}`); passed++; }
	else { console.error(`  ✗ ${label}`); failed++; }
}

// ─── Test 1: addSummary returns the row ID ────────────────────
console.log("\nTest 1: addSummary returns the row ID");
{
	const store = await createTestStore();
	const id = await addSummary(store, {
		session_id: "s1",
		project: "test",
		timestamp: new Date().toISOString(),
		title: "Test summary",
		narrative: "Summary content",
		concepts: ["test"],
		files_read: ["file.ts"],
		files_modified: [],
	});
	assert(id !== null, `Returns non-null ID (got "${id}")`);
	assert(typeof id === "string" && id.length === 8, `ID is 8-char string (got length ${id?.length})`);
}

// ─── Test 2: deleteSessionSummaries keeps excluded ID ─────────
console.log("\nTest 2: deleteSessionSummaries keeps excluded ID");
{
	const store = await createTestStore();

	// Write 3 summaries for same session
	const id1 = await addSummary(store, {
		session_id: "s2", project: "test", timestamp: new Date().toISOString(),
		title: "Summary 1", narrative: "Content 1", concepts: [], files_read: [], files_modified: [],
	});
	const id2 = await addSummary(store, {
		session_id: "s2", project: "test", timestamp: new Date().toISOString(),
		title: "Summary 2", narrative: "Content 2", concepts: [], files_read: [], files_modified: [],
	});
	const id3 = await addSummary(store, {
		session_id: "s2", project: "test", timestamp: new Date().toISOString(),
		title: "Summary 3", narrative: "Content 3", concepts: [], files_read: [], files_modified: [],
	});

	// Delete all except id3
	await deleteSessionSummaries(store, "s2", id3!);

	// Check what remains
	const remaining = await store.table.query()
		.where(`session_id = 's2' AND type = 'summary'`)
		.select(["id", "title"])
		.toArray();

	assert(remaining.length === 1, `Exactly 1 summary remains (got ${remaining.length})`);
	assert(remaining[0]?.id === id3, `Remaining summary is the excluded one (got "${remaining[0]?.id}")`);
}

// ─── Test 3: Full write-then-delete workflow ──────────────────
console.log("\nTest 3: Full write-then-delete workflow");
{
	const store = await createTestStore();

	// Simulate 3 prompt cycles, each writing a checkpoint summary
	let latestId: string | null = null;
	for (let i = 1; i <= 3; i++) {
		// Write new summary
		const newId = await addSummary(store, {
			session_id: "s3", project: "test", timestamp: new Date().toISOString(),
			title: `Checkpoint ${i}`, narrative: `Content after prompt ${i}`, concepts: [], files_read: [], files_modified: [],
		});

		// Delete old summaries
		if (newId) {
			await deleteSessionSummaries(store, "s3", newId);
		}
		latestId = newId;
	}

	// Should have exactly 1 summary — the last checkpoint
	const remaining = await store.table.query()
		.where(`session_id = 's3' AND type = 'summary'`)
		.select(["id", "title"])
		.toArray();

	assert(remaining.length === 1, `Exactly 1 summary after 3 cycles (got ${remaining.length})`);
	assert(remaining[0]?.id === latestId, `It's the latest checkpoint`);
	assert(remaining[0]?.title === "Checkpoint 3", `Title is "Checkpoint 3" (got "${remaining[0]?.title}")`);
}

// ─── Test 4: Delete when no old summaries exist ───────────────
console.log("\nTest 4: Delete is safe when no old summaries exist");
{
	const store = await createTestStore();

	// Write one summary, delete others (there are none)
	const id = await addSummary(store, {
		session_id: "s4", project: "test", timestamp: new Date().toISOString(),
		title: "Only one", narrative: "Content", concepts: [], files_read: [], files_modified: [],
	});

	// This should be a no-op, not throw
	await deleteSessionSummaries(store, "s4", id!);

	const remaining = await store.table.query()
		.where(`session_id = 's4' AND type = 'summary'`)
		.select(["id"])
		.toArray();

	assert(remaining.length === 1, `Still exactly 1 summary (got ${remaining.length})`);
}

// ─── Test 5: Graceful handling of unavailable store ───────────
console.log("\nTest 5: Graceful handling of unavailable store");
{
	const emptyStore: ObservationStore = { available: false, db: null, table: null, embed: null, embeddingDims: EMBEDDING_DIMS };

	const id = await addSummary(emptyStore, {
		session_id: "s5", project: "test", timestamp: new Date().toISOString(),
		title: "Nope", narrative: "Content", concepts: [], files_read: [], files_modified: [],
	});
	assert(id === null, `Returns null for unavailable store (got ${id})`);

	// Should not throw
	await deleteSessionSummaries(emptyStore, "s5", "fake-id");
	assert(true, "deleteSessionSummaries doesn't throw on unavailable store");
}

// ─── Test 6: Summaries for different sessions are independent ─
console.log("\nTest 6: Different sessions are independent");
{
	const store = await createTestStore();

	const idA = await addSummary(store, {
		session_id: "sessionA", project: "test", timestamp: new Date().toISOString(),
		title: "Session A", narrative: "Content A", concepts: [], files_read: [], files_modified: [],
	});
	const idB = await addSummary(store, {
		session_id: "sessionB", project: "test", timestamp: new Date().toISOString(),
		title: "Session B", narrative: "Content B", concepts: [], files_read: [], files_modified: [],
	});

	// Delete old summaries for session A (there are none besides idA)
	await deleteSessionSummaries(store, "sessionA", idA!);

	// Session B should be untouched
	const remainingB = await store.table.query()
		.where(`session_id = 'sessionB' AND type = 'summary'`)
		.select(["id"])
		.toArray();

	assert(remainingB.length === 1, `Session B still has its summary (got ${remainingB.length})`);
	assert(remainingB[0]?.id === idB, `Session B's summary is intact`);
}

// ─── Cleanup ──────────────────────────────────────────────────
fs.rmSync(TEST_DIR, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
