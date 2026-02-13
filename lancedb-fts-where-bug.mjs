#!/usr/bin/env node

/**
 * LanceDB bug: FTS search + .where() filter crashes when rows exist
 * that were added after the FTS index was created.
 *
 * Error: "RowConverter column schema mismatch, expected Float32 got UInt64"
 *
 * Workaround: Rebuild the FTS index after adding new rows, OR do FTS
 * without .where() and filter results in application code.
 *
 * Tested with @lancedb/lancedb 0.13.0 AND 0.26.2 — bug persists in both.
 */

import lancedb from "@lancedb/lancedb";
import * as os from "node:os";
import * as path from "node:path";

const DB_DIR = path.join(os.tmpdir(), "lancedb-fts-where-bug");

async function main() {
  const db = await lancedb.connect(DB_DIR);
  try { await db.dropTable("test"); } catch {}

  // 1. Create table
  const table = await db.createTable("test", [
    { id: "1", project: "alpha", text: "the quick brown fox" },
    { id: "2", project: "beta",  text: "the lazy dog" },
  ]);

  // 2. Create FTS index
  await table.createIndex("text", { config: lancedb.Index.fts() });

  // 3. Add rows AFTER the FTS index was created
  await table.add([
    { id: "3", project: "alpha", text: "another quick example" },
  ]);

  // 4. FTS without .where() — works fine
  const ok = await table.search("quick", "fts", ["text"]).limit(5).toArray();
  console.log(`FTS only: ${ok.length} results ✅`);

  // 5. FTS + .where() — crashes
  try {
    await table.search("quick", "fts", ["text"]).where("project = 'alpha'").limit(5).toArray();
    console.log("FTS + .where(): OK ✅");
  } catch (e) {
    console.log(`FTS + .where(): CRASHED ❌\n  ${e.message.slice(0, 120)}`);
  }

  // 6. Rebuild FTS index — fixes it
  await table.createIndex("text", { config: lancedb.Index.fts(), replace: true });
  const fixed = await table.search("quick", "fts", ["text"]).where("project = 'alpha'").limit(5).toArray();
  console.log(`FTS + .where() after rebuild: ${fixed.length} results ✅`);

  await db.dropTable("test");
}

main().catch(console.error);
