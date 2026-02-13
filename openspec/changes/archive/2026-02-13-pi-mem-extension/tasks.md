## 1. Project Scaffolding

- [x] 1.1 Create extension directory structure at `~/.pi/agent/extensions/pi-mem/` with `index.ts`, `package.json`, and `tsconfig.json`
- [x] 1.2 Add dependencies to `package.json`: `@lancedb/lancedb`, `@sinclair/typebox` (for tool parameter schemas)
- [x] 1.3 Run `npm install` and verify the extension loads in pi without errors
- [x] 1.4 Create the basic extension entry point (`index.ts`) that exports a default function receiving `ExtensionAPI`, registers a `session_start` handler that logs "pi-mem loaded" via `ctx.ui.notify`

## 2. Config and Project Identity

- [x] 2.1 Implement `config.ts` — load and merge `~/.pi-mem/config.json` with defaults (`enabled`, `autoInject`, `maxObservationLength`, `summaryModel`, `indexSize`, `tokenBudget`, `embeddingModel`)
- [x] 2.2 Implement `project.ts` — derive project slug from `git remote get-url origin` (normalized: strip protocol, replace `/` and `:` with `-`, remove `.git` suffix), fallback to `path.basename(cwd)`
- [x] 2.3 Implement `storage.ts` — ensure directory structure exists (`~/.pi-mem/projects/<slug>/sessions/`, `~/.pi-mem/projects/<slug>/memories/`), create dirs on first use
- [x] 2.4 Write tests for project slug normalization (SSH remote, HTTPS remote, no-git fallback)

## 3. Observation Capture

- [x] 3.1 Implement `observer.ts` — observation buffer class that accumulates `{ timestamp, toolName, input, output, cwd }` entries in memory
- [x] 3.2 Implement privacy filtering: strip `<private>...</private>` tags from tool output (replace with `[REDACTED]`), skip capture for file paths matching `.pi-mem-ignore` patterns
- [x] 3.3 Implement output truncation: cap tool output at `maxObservationLength` (default 4000 chars), append `... (truncated, N chars)` marker
- [x] 3.4 Register `tool_result` event handler in `index.ts` that feeds each tool result into the observer buffer and appends to the raw session file
- [x] 3.5 Implement session file writer — create/append to `~/.pi-mem/projects/<slug>/sessions/<timestamp>_<session-id>.md` with the markdown format from design (header on first write, observation entries on subsequent writes)

## 4. Session Summary via Pi SDK Subagent

- [x] 4.1 Implement `compression-agent.ts` — module that creates/reuses a headless pi subagent via `createAgentSession` with `SessionManager.inMemory()`, no tools, and a compression system prompt
- [x] 4.2 Write the compression system prompt (inspired by claude-mem's `buildInitPrompt`): identity as memory compression agent, structured markdown output format (Request, Investigated, Learned, Completed, Next Steps, Files, Concepts), recording focus guidance, skip guidance for routine operations
- [x] 4.3 Implement `summarize()` function that takes raw observations, formats them as a prompt for the subagent, sends via `session.prompt()`, and parses the structured markdown response
- [x] 4.4 Implement response parser: extract each section (Request, What Was Investigated, What Was Learned, What Was Completed, Next Steps, Files, Concepts) from the subagent's markdown output
- [x] 4.5 Register `agent_end` event handler in `index.ts` — if buffer has ≥3 observations, fire off summarization asynchronously (don't block), write memory file to `~/.pi-mem/projects/<slug>/memories/<timestamp>_<session-id>.md`, clear buffer
- [x] 4.6 Implement timeout handling: abort summarization after 15 seconds, fall back to storing raw observations only
- [x] 4.7 Implement project `index.md` updater — after each new summary, prepend a one-line entry (date + request + key outcome) to `index.md`, trim to configured `indexSize` (default 10)

## 5. Memory Storage Utilities

- [x] 5.1 Implement `memory-writer.ts` — write compressed memory files in the standardized markdown format with frontmatter-style metadata (project, date, session ID, concepts)
- [x] 5.2 Implement `memory-reader.ts` — read and parse memory files back into structured objects (for context injection and search results)
- [x] 5.3 Implement `index-reader.ts` — read `index.md` and parse it into a list of `{ date, sessionId, oneLiner }` entries

## 6. Vector Search (LanceDB)

- [x] 6.1 Implement `vector-store.ts` — initialize LanceDB connection to `~/.pi-mem/lancedb/`, create `memories` table with schema (text, project, session_id, date, concepts, files_read, files_modified, vector)
- [x] 6.2 Implement `index-memory()` function — embed memory text and upsert into LanceDB table after each summary is written
- [x] 6.3 Implement `semantic-search()` function — embed query, run vector similarity search on LanceDB, return top-K results with metadata
- [x] 6.4 Implement project-scoped and cross-project filtering on vector search queries
- [x] 6.5 Implement graceful degradation — wrap all LanceDB operations in try/catch, set a `vectorAvailable` flag, log warning on init failure, continue with grep-only mode
- [x] 6.6 Implement configurable embedding model — read `embeddingModel` from config, pass to LanceDB embedding function setup, fall back to LanceDB default

## 7. Keyword Search (Grep Fallback)

- [x] 7.1 Implement `keyword-search.ts` — run `grep -ril` on memory files under `~/.pi-mem/projects/`, return matching file paths
- [x] 7.2 Implement context extraction — for each grep match, read the file and return surrounding lines (±5 lines around match)
- [x] 7.3 Implement project-scoped grep (restrict to `~/.pi-mem/projects/<slug>/memories/`)

## 8. Context Injection

- [x] 8.1 Register `before_agent_start` event handler in `index.ts` — load project `index.md` and recent session summaries, return as injected message
- [x] 8.2 Implement token budget enforcement — estimate token count (~4 chars/token), prioritize: index.md first, then most recent summaries, drop oldest to stay within budget (default 2000 tokens)
- [x] 8.3 Implement progressive disclosure format — render each past session as a compact one-line entry, append "Use mem_search for details" hint
- [x] 8.4 Implement prompt-aware injection — if LanceDB is available, embed the user's current prompt and include top 2 relevant vector search results (within remaining token budget)
- [x] 8.5 Implement configurable auto-injection — check `config.autoInject` flag, skip injection if false

## 9. Memory Tools (mem_search, mem_save)

- [x] 9.1 Register `mem_search` tool via `pi.registerTool()` with TypeBox schema: `query` (string, required), `mode` (StringEnum: semantic/keyword/hybrid, default semantic), `project` (string, optional), `limit` (number, default 5), `cross_project` (boolean, default false)
- [x] 9.2 Implement `mem_search` execute function — dispatch to semantic, keyword, or hybrid search based on mode. Handle `session:<id>` prefix for detailed fetch. Format results with progressive disclosure (compact by default).
- [x] 9.3 Register `mem_save` tool via `pi.registerTool()` with TypeBox schema: `content` (string, required), `title` (string, optional), `concepts` (array of strings, optional), `project` (string, optional)
- [x] 9.4 Implement `mem_save` execute function — write memory file, index in LanceDB, return confirmation with file path
- [x] 9.5 Write clear tool descriptions that guide the LLM on when/how to use each tool

## 10. Privacy

- [x] 10.1 Implement `.pi-mem-ignore` file loader — check project root and `~/.pi-mem/` for ignore patterns, parse gitignore-style patterns
- [x] 10.2 Implement path matching — given a file path from a tool result, check against loaded ignore patterns, return boolean
- [x] 10.3 Integrate privacy filtering into the `tool_result` handler — skip capture if path matches ignore, strip `<private>` tags from output

## 11. Integration and Polish

- [x] 11.1 Register `session_shutdown` handler — flush any remaining buffered observations to the session file
- [x] 11.2 Add `ctx.ui.setStatus("pi-mem", "...")` indicator showing when memories are being captured/injected
- [x] 11.3 Register `/mem` command via `pi.registerCommand()` — show current memory status (project slug, session count, memory count, LanceDB status)
- [x] 11.4 Test full lifecycle: start session → make tool calls → observe observations captured → agent_end triggers summary → new session injects context → mem_search finds past memories
- [x] 11.5 Add README.md to the extension directory with installation and configuration instructions
