## Context

pi-mem is a pi extension that captures tool observations, compresses them into summaries, and injects relevant context into future sessions. Currently it uses:

- **In-memory buffer** → accumulates observations during a prompt cycle
- **Markdown files** → session logs (`sessions/`), AI-generated summaries (`memories/`), project index (`index.md`)
- **LanceDB** → `memories` table with embeddings for semantic search over summaries
- **Compression agent** → spawns `pi` subprocess with `--mode json` to summarize observations via LLM

Claude-mem (the reference architecture) uses SQLite+FTS5 for structured storage/keyword search, and optionally ChromaDB for vector search. We've validated that LanceDB can replace both: it supports SQL-style `.where()` filters, built-in FTS indexes, and vector search with nullable vector columns — all in one table.

**Current codebase**: `index.ts` (main extension, ~200 LOC), `observer.ts` (buffer), `vector-store.ts` (LanceDB), `compression-agent.ts` (subprocess summarizer), `context-injection.ts` (before_agent_start), `tools.ts` (mem_search/mem_save), `mem-search.ts`, `mem-save.ts`, `storage.ts`, `memory-writer.ts`, `memory-reader.ts`, `index-reader.ts`, `index-updater.ts`, `session-writer.ts`, `keyword-search.ts`, `privacy.ts`, `project.ts`, `config.ts`.

**Config**: `~/.pi/agent/pi-mem.json` with `summaryModel`, `thinkingLevel`, `embeddingProvider`, `embeddingModel`.

## Goals / Non-Goals

**Goals:**
- Replace markdown file storage with a single LanceDB table as the sole primary store
- Store per-observation rows (one per tool call) with structured metadata for filtering
- Implement claude-mem's 3-layer progressive-disclosure search pattern (search → timeline → get_observations)
- Use FTS for keyword search over observations (no embedding cost per tool call)
- Use vector search only for summaries and manual saves (preserving current embedding cost profile)
- Inject 3-layer workflow guidance into session context via `before_agent_start`
- Provide a migration script to backfill existing markdown memories into the new table
- Capture user prompts as searchable rows

**Non-Goals:**
- Real-time AI compression of observations (claude-mem does this per tool call via a worker; we defer compression to `agent_end` session summaries to avoid per-observation LLM cost)
- Observation type classification (claude-mem classifies each observation as bugfix/feature/decision/etc. via LLM; we skip this since it requires per-observation LLM calls)
- ChromaDB integration or any external vector DB
- Multi-project worktree support (claude-mem's feature; we keep simple project slug detection)
- Observation modes or themes (claude-mem's configurable presentation modes)
- Token economics tracking (claude-mem tracks read/discovery tokens per observation)

## Decisions

### 1. Single unified table vs. separate tables

**Decision**: Single `observations` table with a `type` column discriminating between observation, prompt, summary, and manual rows.

**Rationale**: Confirmed via testing that LanceDB handles nullable vector columns correctly — rows with `vector: null` are skipped by `vectorSearch()` but fully participate in FTS and filter queries. A single table means one FTS index, one set of scalar indexes, and simpler query logic. Claude-mem uses separate SQLite tables for observations, session_summaries, and user_prompts, but that's a SQLite-ism (FTS5 virtual tables are per-table).

**Alternative**: Separate tables per type. Rejected because it requires cross-table queries for timeline views and complicates the schema without any query benefit in LanceDB.

### 2. LanceDB schema

```
Table: observations
─────────────────────────────────────────────────────────────
id              string    UUID (e.g., "a3f08c2b")
session_id      string    Session UUID (groups observations within a prompt cycle)
project         string    Project slug (e.g., "pi-mem")
type            string    "observation" | "prompt" | "summary" | "manual"
timestamp       string    ISO 8601 (e.g., "2026-02-13T10:15:30Z")
tool_name       string    Tool name for observations (e.g., "bash", "read", "edit"); empty for other types
title           string    Short title (LLM-generated for summaries; tool_name+input_summary for observations)
text            string    Full searchable text content (FTS indexed):
                          - observations: truncated tool output
                          - prompts: user prompt text
                          - summaries: full LLM-generated summary
                          - manual: user-provided content
concepts        string    Comma-separated concept tags (e.g., "architecture,decision")
files           string    Comma-separated file paths touched
vector          float[1536]  Nullable. Only populated for summaries and manual saves.
```

**Indexes**:
- FTS index on `text` column — primary keyword search
- B-Tree scalar indexes on `project`, `session_id`, `timestamp` — filter and sort
- Bitmap index on `type` — categorical filter (4 values)
- No vector index at current scale; add IVF_PQ when >10K embedded rows

**Rationale**: Matches claude-mem's observation schema (id, session_id, project, type, text, title, concepts, files_read, files_modified, created_at) adapted for LanceDB's column types. We merge `files_read` and `files_modified` into a single `files` column since we capture them at write time from tool input. The `text` column is the FTS target and holds different content depending on type. The `vector` column is nullable — only summaries and manual saves get embeddings, matching claude-mem's architecture where FTS5 handles observation search and ChromaDB handles semantic search on summaries.

### 3. Observation capture: immediate write vs. buffered

**Decision**: Write each observation to LanceDB immediately in `tool_result` handler. Remove the in-memory `ObservationBuffer`.

**Rationale**: Buffering was only needed because the old architecture wrote a single markdown file at session end. With LanceDB, each write is an append to a columnar file — fast and durable. Immediate writes mean observations survive crashes (no data loss if session aborts). The current buffer is consumed only at `agent_end` for summarization, which can instead query LanceDB directly: `table.query().where("session_id = '...'").toArray()`.

**Trade-off**: More writes (one per tool call vs. one batch at end). LanceDB's append-only format handles this well, but may need compaction after long sessions. We'll compact at `agent_end`.

### 4. Search tool design: matching claude-mem's progressive disclosure

**Decision**: Four tools matching claude-mem's pattern, with workflow docs injected via `before_agent_start`.

**Tool 1: `search`**
- FTS query on `text` column + optional filters (project, type, dateStart/dateEnd, tool_name)
- Returns compact index: `| id | timestamp | type | tool_name | title |` (~50-100 tokens/result)
- Uses `.select(["id", "session_id", "project", "type", "timestamp", "tool_name", "title"])` for column projection (no `text`, no `vector`)
- Pagination via `limit` + `offset`
- Order by `timestamp DESC` (default) or `relevance`

**Tool 2: `timeline`**
- Given an anchor observation ID (or a query to find one), return N observations before and after it chronologically
- Queries: `table.query().where("session_id = '...' AND timestamp <= '...'").orderBy("timestamp DESC").limit(depth_before)` and similar for after
- Returns medium detail: id, timestamp, type, tool_name, title, and first 200 chars of text
- Can scope to same session (default) or same project

**Tool 3: `get_observations`**
- Fetch full details for specific observation IDs
- Queries: `table.query().where("id IN ('id1', 'id2', ...)").toArray()`
- Returns everything: id, session_id, project, type, timestamp, tool_name, title, text, concepts, files
- Always batch — caller provides array of IDs

**Tool 4: `save_memory`**
- Write a `type = "manual"` row with an embedding vector
- Params: text (required), title (optional), project (optional), concepts (optional)
- Compute embedding via existing `embed()` function, then insert row

**Workflow guidance**: Injected in `before_agent_start` context alongside project memories:
```
3-LAYER WORKFLOW (ALWAYS FOLLOW):
1. search(query) → Get index with IDs (~50-100 tokens/result)
2. timeline(anchor=ID) → Get context around interesting results
3. get_observations([IDs]) → Fetch full details ONLY for filtered IDs
NEVER fetch full details without filtering first. 10x token savings.
```

This replaces claude-mem's `__IMPORTANT` fake tool — we have a real context injection mechanism via pi's extension API.

### 5. Context injection redesign

**Decision**: `before_agent_start` queries LanceDB instead of reading markdown files.

The injected context has three sections:
1. **Recent summaries index**: `table.query().where("project = '...' AND type = 'summary'").orderBy("timestamp DESC").limit(N).select(["session_id", "timestamp", "title"])` — replaces the old `index.md`
2. **Prompt-aware semantic search**: If `vectorStore.embed` is available, compute embedding of user prompt and run `table.vectorSearch(vec).where("project = '...'").limit(3)` — replaces the old `readProjectMemories` + `semanticSearch` calls
3. **Workflow guidance**: Static text explaining the 3-layer search pattern

All within the existing `tokenBudget` config.

### 6. Summary generation at agent_end

**Decision**: Keep the existing `compression-agent.ts` subprocess approach. Instead of reading from `ObservationBuffer`, query LanceDB:

```typescript
const observations = await table.query()
  .where(`session_id = '${sessionId}' AND type = 'observation'`)
  .orderBy("timestamp ASC")
  .toArray();
```

Format observations into the same prompt, get LLM summary, write as a `type = "summary"` row with embedding. Also run compaction after summary write.

### 7. Files to delete vs. keep

**Delete** (functionality replaced by LanceDB):
- `memory-writer.ts` — wrote markdown memory files
- `memory-reader.ts` — parsed markdown memory files
- `index-updater.ts` — updated project index.md
- `index-reader.ts` — read project index.md
- `session-writer.ts` — wrote raw session markdown logs
- `keyword-search.ts` — grep-based keyword search over markdown files
- `mem-search.ts` — old search implementation
- `mem-save.ts` — old save implementation

**Rewrite heavily**:
- `vector-store.ts` → becomes `observation-store.ts`: manages the unified table, FTS/vector/filter queries, schema creation, index creation, compaction
- `tools.ts` → new tool registrations for `search`, `timeline`, `get_observations`, `save_memory`
- `context-injection.ts` → reads from LanceDB instead of markdown
- `index.ts` → remove buffer, add immediate observation writes, query LanceDB for summaries
- `observer.ts` → simplify to just `Observation` type + privacy helpers (remove `ObservationBuffer` class)
- `storage.ts` → simplify (no more sessions/memories dirs, just LanceDB path)

**Keep as-is**:
- `compression-agent.ts` — subprocess summarizer (unchanged)
- `config.ts` — add new config fields
- `project.ts` — project slug detection (unchanged)
- `privacy.ts` — privacy filtering (unchanged)

## Risks / Trade-offs

**[Write amplification]** → Each tool call now writes to LanceDB instead of appending to an in-memory buffer. LanceDB's append-only columnar format handles frequent small writes well, but fragmentation grows over time. **Mitigation**: Compact the table at `agent_end` after writing the summary row. This is a natural batch point.

**[FTS index rebuild]** → LanceDB FTS indexes need to be recreated after adding rows (unlike SQLite FTS5 which updates incrementally via triggers). **Mitigation**: Recreate FTS index at `agent_end` alongside compaction. During a session, FTS won't find new observations from the current session — but that's acceptable since the agent already has current-session context in its conversation history.

**[Migration complexity]** → Existing markdown memories must be backfilled. Some have embeddings in the old `memories` table; those should be preserved. **Mitigation**: Migration script reads all `memories/*.md` files, parses them, and inserts as `type = "summary"` rows. For rows that have embeddings in the old table, copy the vector. Others get `vector: null` (can be backfilled later).

**[Breaking tool API]** → Models that have learned to use `mem_search` and `mem_save` will not find them. **Mitigation**: The new tools are registered with clear descriptions and the workflow guidance is injected at session start. Models adapt quickly to available tool names.

**[LanceDB FTS limitations]** → LanceDB FTS is less mature than SQLite FTS5 (no porter stemming, no phrase queries confirmed). **Mitigation**: At our scale, basic tokenized FTS is sufficient. If FTS proves inadequate, we can add vector search as a fallback for keyword queries.

## Migration Plan

1. **Create new table**: On first startup with new code, create the `observations` table with the new schema. Don't touch the old `memories` table yet.
2. **Run migration script**: `migrate-to-observations.mjs` reads all `~/.pi-mem/projects/*/memories/*.md`, parses each file, and inserts as `type = "summary"` rows. Copies vectors from old `memories` table where available.
3. **Verify**: Query the new table to confirm row counts match.
4. **Old data**: Leave old markdown files and `memories` table on disk. They're not read by new code. User can delete manually once satisfied.
5. **Rollback**: If something goes wrong, revert the extension code. Old markdown files are untouched and will work with the old code.

## Open Questions

1. **Compaction frequency**: Should we compact only at `agent_end`, or also periodically (e.g., every 50 writes)? Need to benchmark LanceDB write+compact latency.
2. **FTS index lifecycle**: Does LanceDB auto-update FTS indexes on insert, or do we need explicit index rebuilds? Need to test. If explicit, when to rebuild — only at `agent_end` or more often?
3. **Observation text content**: For observation rows, should `text` contain just the tool output, or a formatted combination of tool name + input summary + output? The latter is better for FTS (searching "edited config.ts" would match) but larger.
4. **ID format**: Integer autoincrement (like claude-mem) or short UUID string? LanceDB doesn't have autoincrement; UUIDs are natural. But integer IDs are more ergonomic for `timeline(anchor=42)` calls. Could use a monotonic counter stored in config.
