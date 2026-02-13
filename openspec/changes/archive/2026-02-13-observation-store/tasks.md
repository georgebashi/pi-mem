## 1. Observation Store (LanceDB unified table)

- [x] 1.1 Create `observation-store.ts` replacing `vector-store.ts`: define the LanceDB table schema (id, session_id, project, type, timestamp, tool_name, title, text, concepts, files, vector), table creation, table opening, and the `embed()` function (reuse existing provider-based embedding logic)
- [x] 1.2 Implement `addObservation()` function: write a single row to the observations table with `vector: null`. Handle table creation on first write.
- [x] 1.3 Implement `addSummary()` function: write a `type = "summary"` row with an embedding vector computed via `embed()`. Handle embedding failure gracefully (write with `vector: null`).
- [x] 1.4 Implement `addManualMemory()` function: write a `type = "manual"` row with an embedding vector.
- [x] 1.5 Implement `addPrompt()` function: write a `type = "prompt"` row with `vector: null`.
- [x] 1.6 Implement `compactAndReindex()` function: compact the table and recreate the FTS index on the `text` column. Create scalar indexes (B-Tree on project, session_id, timestamp; Bitmap on type) if they don't exist.
- [x] 1.7 Implement `getSessionObservations(sessionId)`: query observations for a session, ordered by timestamp ASC (used by agent_end for summarization).

## 2. Search Query Functions

- [x] 2.1 Implement `ftsSearch(query, filters, limit, offset, orderBy)`: FTS search on the `text` column with `.where()` filters for project, type, obs_type, dateStart, dateEnd. Return compact index columns via `.select()` (id, session_id, project, type, timestamp, tool_name, title).
- [x] 2.2 Implement `timelineSearch(anchorId | query, depthBefore, depthAfter, project)`: find anchor observation, then query N rows before/after by timestamp. Return medium-detail rows (index columns + first 200 chars of text).
- [x] 2.3 Implement `getObservationsByIds(ids)`: fetch full rows by ID array. Return all columns except vector.
- [x] 2.4 Implement `getRecentSummaries(project, limit)`: query `type = 'summary'` rows ordered by timestamp DESC, limited to N. Used by context injection.
- [x] 2.5 Implement `semanticSearch(queryVector, project, limit)`: vector search with pre-filtering by project. Used by context injection.

## 3. Search Tools Registration

- [x] 3.1 Rewrite `tools.ts`: register `search` tool with params (query, limit, offset, project, type, obs_type, dateStart, dateEnd, orderBy). Description: "Step 1: Search memory. Returns compact index with IDs."
- [x] 3.2 Register `timeline` tool with params (anchor, query, depth_before, depth_after, project). Description: "Step 2: Get chronological context around a result."
- [x] 3.3 Register `get_observations` tool with params (ids required, orderBy, limit, project). Description: "Step 3: Fetch full details for specific IDs. Always batch multiple IDs."
- [x] 3.4 Register `save_memory` tool with params (text required, title, project, concepts). Description: "Save important information to memory for future sessions."
- [x] 3.5 Implement tool execute callbacks in `index.ts` that call the query functions from step 2 and format results as text.

## 4. Context Injection Rewrite

- [x] 4.1 Rewrite `context-injection.ts`: replace markdown file reading with LanceDB queries. Section 1: recent summaries index via `getRecentSummaries()`. Section 2: prompt-aware semantic search via `semanticSearch()`. Section 3: 3-layer workflow guidance static text.
- [x] 4.2 Add workflow guidance text constant matching claude-mem's pattern: "3-LAYER WORKFLOW (ALWAYS FOLLOW): 1. search(query) → ... 2. timeline(anchor=ID) → ... 3. get_observations([IDs]) → ..."

## 5. Main Extension Rewrite (index.ts)

- [x] 5.1 Rewrite `session_start` handler: initialize observation store (open/create table), load config, detect project. Remove markdown directory creation, remove ObservationBuffer.
- [x] 5.2 Rewrite `tool_result` handler: call `addObservation()` directly instead of buffering. Keep privacy filtering (stripPrivateTags, shouldIgnorePath, truncateOutput).
- [x] 5.3 Add prompt capture in `before_agent_start`: call `addPrompt()` with the user's prompt text before context injection.
- [x] 5.4 Rewrite `agent_end` handler: query observations from LanceDB via `getSessionObservations()`, pass to compression agent, write summary via `addSummary()`, call `compactAndReindex()`. Remove markdown file writing.
- [x] 5.5 Simplify `session_shutdown` handler: remove buffer flush logic.
- [x] 5.6 Update `/mem` command: show observation count from LanceDB query instead of file counts.

## 6. Cleanup: Delete Obsolete Files

- [x] 6.1 Delete `memory-writer.ts`, `memory-reader.ts`, `index-updater.ts`, `index-reader.ts`, `session-writer.ts`, `keyword-search.ts`, `mem-search.ts`, `mem-save.ts`
- [x] 6.2 Simplify `storage.ts`: remove sessions/memories directory creation, keep only LanceDB path constant. Or merge into `config.ts` if trivial.
- [x] 6.3 Simplify `observer.ts`: remove `ObservationBuffer` class. Keep `Observation` type, `stripPrivateTags()`, `truncateOutput()`.
- [x] 6.4 Delete `vector-store.ts` (replaced by `observation-store.ts`)

## 7. Migration Script

- [x] 7.1 Create `migrate-to-observations.mjs`: read all `~/.pi-mem/projects/*/memories/*.md` files, parse each with `parseMemoryContent()`, insert as `type = "summary"` rows in the new table. Copy embedding vectors from old `memories` LanceDB table where available. Set `vector: null` for rows without embeddings.
- [x] 7.2 Run migration, verify row counts match, compact and create indexes.

## 8. Testing

- [x] 8.1 Test observation store: create table, write observation/prompt/summary/manual rows, verify FTS search, filter queries, vector search, compaction
- [x] 8.2 Test search tools end-to-end: search with filters, timeline around anchor, get_observations batch, save_memory
- [x] 8.3 Test context injection: verify summaries index, semantic search results, and workflow guidance are injected
- [x] 8.4 Test full session lifecycle: session_start → tool_result captures → before_agent_start prompt capture + injection → agent_end summarization → verify all rows in LanceDB
