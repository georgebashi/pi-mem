## Why

Pi sessions are ephemeral — when a session ends or compacts, the agent loses all context about what it did, what it learned, and what decisions were made. Developers must re-explain project context every session. Claude-mem solved this for Claude Code with a persistent memory system, but it's tightly coupled to Claude Code's hook system and agent SDK. Pi has a rich extension API with equivalent lifecycle hooks (`session_start`, `tool_result`, `agent_end`, `session_shutdown`) that can support the same pattern. We need a native pi extension that automatically captures observations, compresses them into searchable memories, and injects relevant context into future sessions.

## What Changes

- **Automatic observation capture**: Hook into `tool_result` events to record what pi does (tool name, input, output, cwd) as raw observations during a session
- **AI-powered session summaries**: At session end (`agent_end` or `session_shutdown`), compress raw observations into a structured summary (what was requested, what was investigated, what was learned, what was completed, next steps, files touched)
- **Markdown-based storage**: Store memories as human-readable markdown files — one file per session in `~/.pi-mem/sessions/`, one summary index file per project, easily browsable and grep-friendly
- **Vector search via LanceDB**: Embed observation and summary text into a local LanceDB database for semantic search across all sessions and projects
- **Context injection at session start**: On `session_start`, load relevant recent memories for the current project and inject them via `before_agent_start` as additional context
- **Memory search tools**: Register custom tools (`mem_search`, `mem_save`) that the LLM can call to query past sessions or manually save important information
- **Privacy controls**: Support `<private>` tags or a `.pi-mem-ignore` pattern file to exclude sensitive content from storage
- **Project awareness**: Automatically detect project identity from cwd/git remote, scope memories per project, support cross-project search

## Capabilities

### New Capabilities
- `observation-capture`: Automatic capture of tool executions as raw observations during a session, with privacy filtering
- `session-summary`: AI-powered compression of raw observations into structured session summaries at session end
- `memory-storage`: Markdown file-based storage for sessions and summaries, with a per-project index, stored in `~/.pi-mem/`
- `vector-search`: LanceDB-based semantic embedding and search across all memories, plus grep-based keyword fallback
- `context-injection`: Automatic injection of relevant past memories into new sessions at startup
- `memory-tools`: LLM-callable tools for searching memories (`mem_search`) and manually saving important information (`mem_save`)

### Modified Capabilities
<!-- No existing capabilities to modify — this is a greenfield project -->

## Impact

- **New pi extension**: `~/.pi/agent/extensions/pi-mem/` (global extension, works across all projects)
- **New dependencies**: `lancedb` (embedded vector DB), an embedding model (likely `@lancedb/embeddings` or a local model), `node:fs` and `node:path` for markdown I/O
- **Disk usage**: `~/.pi-mem/` directory for markdown files and LanceDB data (~1-10MB per active project depending on session count)
- **LLM cost**: One summarization call per session end (using a small/cheap model), plus embedding calls for vector indexing
- **No breaking changes**: Purely additive — pi works exactly the same without the extension loaded
- **Performance**: All capture is synchronous and lightweight (append to in-memory buffer); summarization and embedding happen asynchronously at session end to avoid blocking
