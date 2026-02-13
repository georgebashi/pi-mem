## Why

pi-mem currently stores session-level summaries — one markdown file per prompt cycle — which loses per-observation granularity at write time. This means we can't search for individual tool calls, navigate timelines around specific events, or filter by tool type or file. Claude-mem solves this by storing every tool execution as an individual observation in SQLite with FTS5, plus optional ChromaDB for semantic search. We've confirmed that LanceDB can replace both SQLite+FTS5 and ChromaDB in a single embedded store — supporting SQL-style filters, full-text search, and vector search with nullable vector columns in one table. This change migrates pi-mem from session-level markdown summaries to per-observation storage in LanceDB, enabling claude-mem-equivalent query capabilities with a simpler single-engine architecture.

## What Changes

- **Per-observation capture**: `tool_result` handler writes one LanceDB row per tool call immediately (no buffering), with structured metadata columns (project, session_id, timestamp, tool_name, files)
- **User prompt capture**: `before_agent_start` captures the user's prompt as a `type = "prompt"` row
- **Session summaries become rows**: At `agent_end`, the LLM-generated summary is stored as a `type = "summary"` row with an embedding vector, rather than a standalone markdown file
- **Manual saves become rows**: `mem_save` becomes `save_memory`, writes a `type = "manual"` row with an embedding vector
- **Unified LanceDB table**: Single `observations` table replaces markdown files + the current `memories` LanceDB table. FTS index on text, scalar indexes on metadata, nullable vector column
- **New search tools matching claude-mem's 3-layer progressive disclosure**:
  - `search`: FTS + filters, returns compact index with IDs (~50-100 tokens/result). Params: query, limit, project, type, obs_type, dateStart, dateEnd, offset, orderBy
  - `timeline`: Chronological context around an anchor observation or query. Params: anchor (observation ID) OR query, depth_before, depth_after, project
  - `get_observations`: Fetch full details by ID array. Params: ids (required), orderBy, limit, project. Always batch multiple IDs.
  - `save_memory`: Save a manual memory for semantic search. Params: text (required), title, project, concepts
- **3-layer workflow guidance injected via context, not as a tool**: Claude-mem uses a fake `__IMPORTANT` tool to inject workflow docs because MCP tools are their only injection point. We use pi's `before_agent_start` hook to inject the progressive-disclosure instructions directly into the session context alongside project memories.
- **Observation rows have no embeddings**: Only summaries and manual saves get vector embeddings. FTS and column filters handle observation queries. This matches claude-mem's approach (FTS over observations, optional ChromaDB for semantic search on summaries)
- **No more markdown file storage**: LanceDB is the sole primary store. The markdown session files, memory files, and project index files are all eliminated. Humans can ask the agent to dump/export data if needed.
- **Project index derived from queries**: The `index.md` file is replaced by a LanceDB query (`type = 'summary'`, ordered by timestamp, limited to N)
- **Context injection reads from LanceDB**: `before_agent_start` queries the observations table instead of reading markdown files

## Capabilities

### New Capabilities
- `observation-store`: Unified LanceDB table storing all observations, prompts, summaries, and manual saves with structured metadata columns, FTS index, and nullable vector column
- `search-tools`: Progressive-disclosure search tools matching claude-mem's 3-layer workflow (`search`, `timeline`, `get_observations`, `save_memory`) with richer filtering (date range, type, tool name, project), pagination, and ordering. The 3-layer workflow documentation is injected via `before_agent_start` context (not as a fake tool like claude-mem's `__IMPORTANT`).
- `prompt-capture`: Capture user prompts as searchable rows alongside tool observations

### Modified Capabilities
- `observation-capture`: Changes from buffering observations in memory to writing LanceDB rows immediately per tool call
- `session-summary`: Changes from writing a markdown file to writing a LanceDB row with `type = "summary"` and an embedding vector
- `memory-storage`: Primary store moves from markdown files to LanceDB. Markdown files eliminated entirely.
- `context-injection`: Reads from LanceDB queries instead of markdown files and the project index
- `vector-search`: Embeddings only on summaries and manual saves (not all observations). Search uses `vectorSearch()` with pre-filtering

## Impact

- **Storage migration**: Existing markdown memories need to be backfilled into the new LanceDB table. A migration script will be provided.
- **Old LanceDB table replaced**: The current `memories` table (session-level summaries with vectors) is replaced by the unified `observations` table
- **Tool API change**: **BREAKING** — `mem_search` and `mem_save` tools are replaced by `search`, `timeline`, `get_observations`, and `save_memory`. Workflow guidance injected via session context.
- **Markdown files eliminated**: **BREAKING** — `~/.pi-mem/projects/*/sessions/`, `~/.pi-mem/projects/*/memories/`, and `index.md` files are no longer written. Existing files remain on disk but are not read.
- **No new dependencies**: LanceDB is already a dependency. No SQLite, no ChromaDB, no separate server process.
- **Embedding cost unchanged**: Only summaries and manual saves get embeddings, same as today
- **Disk usage increase**: Per-observation rows are more numerous than per-session summaries, but each row is small (truncated input/output). Expect 10-50x more rows but similar total storage.
- **Write latency**: Each `tool_result` now does a LanceDB write instead of an in-memory buffer append. LanceDB writes are fast (append-only columnar format) but this is a change from zero-IO to one-IO per tool call.
