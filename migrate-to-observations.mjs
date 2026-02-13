#!/usr/bin/env node

/**
 * Migration script: backfill existing markdown memories into the new LanceDB observations table.
 *
 * Reads all memory files from ~/.pi-mem/projects/, parses them,
 * and inserts as type="summary" rows. Copies embedding vectors from
 * the old `memories` LanceDB table where available.
 *
 * Usage: node migrate-to-observations.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import lancedb from "@lancedb/lancedb";

const PI_MEM_DIR = path.join(os.homedir(), ".pi-mem");
const LANCEDB_DIR = path.join(PI_MEM_DIR, "lancedb");
const PROJECTS_DIR = path.join(PI_MEM_DIR, "projects");
const NEW_TABLE = "observations";
const OLD_TABLE = "memories";

// ─── Parse a memory markdown file ─────────────────────────────

function parseMemoryFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const fileName = path.basename(filePath, ".md");

  // Extract metadata from header
  const projectMatch = content.match(/\*\*Project:\*\*\s*(.+)/);
  const dateMatch = content.match(/\*\*Date:\*\*\s*(.+)/);
  const sessionMatch = content.match(/\*\*Session:\*\*\s*(.+)/);
  const conceptsMatch = content.match(/\*\*Concepts:\*\*\s*(.+)/);

  const project = projectMatch?.[1]?.trim() ?? "";
  const date = dateMatch?.[1]?.trim() ?? "";
  const sessionId = sessionMatch?.[1]?.trim() ?? fileName.split("_").pop() ?? "";
  const concepts = conceptsMatch?.[1]?.trim() ?? "";

  // Extract request as title
  const requestMatch = content.match(/## Request\s*\n(.*?)(\n|$)/);
  const title = requestMatch?.[1]?.trim()?.slice(0, 100) ?? "Session summary";

  // Extract files
  const filesMatch = content.match(/## Files\s*\n([\s\S]*?)(\n##|$)/);
  const files = filesMatch
    ? filesMatch[1]
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*\*\*(Read|Modified):\*\*\s*/, "").trim())
        .filter(Boolean)
        .join(", ")
    : "";

  // Build timestamp from filename or date
  const tsMatch = fileName.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
  const timestamp = tsMatch
    ? tsMatch[1].replace(/-/g, (m, offset) => (offset > 9 ? ":" : m)).replace("T", "T") + "Z"
    : date
      ? new Date(date).toISOString()
      : new Date().toISOString();

  return {
    session_id: sessionId,
    project,
    timestamp,
    title,
    text: content,
    concepts,
    files,
  };
}

// ─── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("=== Migrate markdown memories to LanceDB observations table ===\n");

  // Find all memory files
  const memoryFiles = [];
  if (fs.existsSync(PROJECTS_DIR)) {
    for (const projectDir of fs.readdirSync(PROJECTS_DIR)) {
      const memoriesDir = path.join(PROJECTS_DIR, projectDir, "memories");
      if (!fs.existsSync(memoriesDir)) continue;
      for (const file of fs.readdirSync(memoriesDir)) {
        if (file.endsWith(".md")) {
          memoryFiles.push({
            path: path.join(memoriesDir, file),
            projectDir,
          });
        }
      }
    }
  }

  console.log(`Found ${memoryFiles.length} memory files to migrate.\n`);
  if (memoryFiles.length === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  // Connect to LanceDB
  const db = await lancedb.connect(LANCEDB_DIR);

  // Try to load old vectors from the memories table
  let oldVectors = new Map(); // session_id -> vector
  try {
    const oldTable = await db.openTable(OLD_TABLE);
    const oldRows = await oldTable.query().toArray();
    for (const row of oldRows) {
      if (row.session_id && row.vector) {
        oldVectors.set(row.session_id, row.vector);
      }
    }
    console.log(`Loaded ${oldVectors.size} existing vectors from old '${OLD_TABLE}' table.\n`);
  } catch {
    console.log(`No old '${OLD_TABLE}' table found (or empty). Vectors will be null.\n`);
  }

  // Parse all memory files into rows
  const rows = [];
  for (const { path: filePath, projectDir } of memoryFiles) {
    try {
      const parsed = parseMemoryFile(filePath);

      // If project wasn't in the file header, use the directory name
      if (!parsed.project) {
        parsed.project = projectDir;
      }

      // Look up old vector — convert Arrow Vector to plain array if needed
      const rawVector = oldVectors.get(parsed.session_id) ?? null;
      // LanceDB FixedSizeList doesn't handle true nulls well in mixed batches,
      // so we use a zero vector as a sentinel for "no embedding"
      let vector;
      if (rawVector) {
        vector = Array.isArray(rawVector) ? rawVector : Array.from(rawVector);
      } else {
        vector = new Array(1536).fill(0);
      }

      rows.push({
        id: crypto.randomUUID().slice(0, 8),
        session_id: parsed.session_id,
        project: parsed.project,
        type: "summary",
        timestamp: parsed.timestamp,
        tool_name: "",
        title: parsed.title,
        text: parsed.text,
        concepts: parsed.concepts,
        files: parsed.files,
        vector,
      });

      console.log(`  ✓ ${path.basename(filePath)} → ${parsed.project} [${parsed.session_id}]${vector ? " (with vector)" : ""}`);
    } catch (e) {
      console.log(`  ✗ ${path.basename(filePath)} — ${e.message}`);
    }
  }

  console.log(`\nParsed ${rows.length} rows. Writing to '${NEW_TABLE}' table...\n`);

  // Sort so rows with vectors come first (LanceDB needs to see vector size from first non-null)
  rows.sort((a, b) => {
    if (a.vector && !b.vector) return -1;
    if (!a.vector && b.vector) return 1;
    return 0;
  });

  // Write all rows (all have vectors now — zeros for those without real embeddings)
  let table;
  try {
    table = await db.openTable(NEW_TABLE);
    await table.add(rows);
    console.log(`Added ${rows.length} rows to existing '${NEW_TABLE}' table.`);
  } catch {
    table = await db.createTable(NEW_TABLE, rows);
    console.log(`Created '${NEW_TABLE}' table with ${rows.length} rows.`);
  }

  // Create FTS index
  try {
    await table.createIndex("text", { config: lancedb.Index.fts() });
    console.log("Created FTS index on text column.");
  } catch (e) {
    console.log(`FTS index creation failed: ${e.message}`);
  }

  // Create scalar indexes
  try {
    await table.createIndex("project");
    await table.createIndex("session_id");
    await table.createIndex("timestamp");
    await table.createIndex("type");
    console.log("Created scalar indexes.");
  } catch (e) {
    console.log(`Scalar index creation failed: ${e.message}`);
  }

  // Compact
  try {
    await table.optimize({ cleanupOlderThan: new Date() });
    console.log("Compacted table.");
  } catch (e) {
    console.log(`Compaction failed: ${e.message}`);
  }

  // Verify
  const count = await table.countRows();
  console.log(`\n✓ Migration complete. Table '${NEW_TABLE}' has ${count} total rows.`);
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
