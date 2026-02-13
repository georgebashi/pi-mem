## Context

Pi sessions are ephemeral. When a session ends or compacts, the agent loses all knowledge of what happened. Claude-mem solves this for Claude Code using a tightly-coupled plugin architecture (lifecycle hooks, a background worker service, SQLite + FTS5, Chroma vector DB, and a separate Claude SDK agent for compression). We need to reimplement the same core value — persistent, searchable memory across sessions — as a native pi extension, using simpler primitives: markdown files for storage, grep for keyword search, and LanceDB for vector search.

Pi's extension API provides all the hooks we need:
- `session_start` — load and inject past memories
- `before_agent_start` — inject context into LLM messages and system prompt
- `tool_result` — capture observations as they happen
- `agent_end` — compress observations into a summary after each prompt
- `session_shutdown` — final cleanup / flush
- `pi.registerTool()` — expose `mem_search` and `mem_save` to the LLM
- `pi.appendEntry()` — persist extension state within the pi session

The extension lives at `~/.pi/agent/extensions/pi-mem/` (global, all projects). Data lives at `~/.pi-mem/` (outside pi's config, user-owned).

## Goals / Non-Goals

**Goals:**
- Automatically capture what pi does during a session (tool calls + results)
- Compress raw observations into structured, human-readable session summaries
- Store memories as markdown files that are browseable with any text editor and searchable with grep
- Provide vector-based semantic search via LanceDB for fuzzy/conceptual queries
- Inject relevant recent context at session start so the LLM knows what happened before
- Let the LLM search and save memories on demand via custom tools
- Support per-project memory scoping with cross-project search capability
- Privacy controls to exclude sensitive content

**Non-Goals:**
- Web viewer UI (claude-mem's React viewer — unnecessary complexity for v1)
- MCP server (pi's custom tools are sufficient)
- Background worker service (pi's hooks are synchronous-enough; we summarize inline at agent_end)
- Multi-language/i18n support for prompts
- Real-time SSE streaming of memory events
- Mode profiles (code, email-investigation, etc.) — single mode for v1
- Worktree support — single project identity per cwd for v1

## Decisions

### 1. Markdown files over SQLite

**Decision:** Store all memories as plain markdown files in `~/.pi-mem/`.

**Rationale:** Markdown is human-readable, grep-friendly, git-friendly, and trivially inspectable. Claude-mem's SQLite + FTS5 approach is powerful but opaque — you need tooling to inspect it. For v1, markdown gives us:
- Transparency: users can browse `~/.pi-mem/projects/my-app/` and read session histories
- Simplicity: no native module compilation issues (bun:sqlite caused headaches for claude-mem)
- Durability: plain text survives across node/bun version upgrades

**Alternatives considered:**
- SQLite + FTS5 (claude-mem's approach) — more powerful queries but adds native dependency, opaque storage
- JSON files — machine-readable but not human-friendly
- Single large file per project — doesn't scale, hard to search

**Directory structure:**
```
~/.pi-mem/
├── projects/
│   └── <project-slug>/
│       ├── index.md              # Project overview, auto-updated
│       ├── sessions/
│       │   ├── 2026-02-11T22-59-00_<session-id>.md
│       │   └── 2026-02-12T10-30-00_<session-id>.md
│       └── memories/
│           ├── 2026-02-11T22-59-00_<session-id>.md   # Compressed observations
│           └── 2026-02-12T10-30-00_<session-id>.md
├── lancedb/                      # LanceDB vector data (auto-managed)
└── config.json                   # User preferences (optional)
```

- `sessions/<timestamp>_<id>.md` — raw observation log (append-only during session)
- `memories/<timestamp>_<id>.md` — AI-compressed summary (written at agent_end)
- `index.md` — rolling project context (last N summaries, key facts)

### 2. Two-tier storage: raw observations + compressed memories

**Decision:** Keep raw observations in `sessions/` and compressed memories in `memories/`, following claude-mem's observation → summary pipeline.

**Rationale:** Raw observations are verbose (full tool inputs/outputs) but complete. Compressed memories are concise but lossy. Keeping both means:
- Raw sessions serve as an audit trail and can be re-processed
- Compressed memories are what gets injected into context (token-efficient)
- Vector search indexes the compressed memories (better signal-to-noise)

**Session file format** (raw, append-only during session):
```markdown
# Session: 2026-02-11T22:59:00

**Project:** my-app
**Prompt:** "Fix the login bug in auth.ts"
**Started:** 2026-02-11T22:59:00Z

---

## Observations

### [22:59:05] read auth.ts
- **Input:** `{ path: "src/auth.ts" }`
- **Output:** (248 lines)

### [22:59:12] bash
- **Input:** `{ command: "npm test -- --grep auth" }`
- **Output:** `3 tests failed`

### [23:01:30] edit auth.ts
- **Input:** `{ path: "src/auth.ts", oldText: "...", newText: "..." }`
- **Output:** `OK`
```

**Memory file format** (compressed, written at agent_end):
```markdown
# Session Summary

**Project:** my-app
**Date:** 2026-02-11
**Session:** abc123

## Request
Fix the login bug in auth.ts

## What Was Investigated
- Read auth.ts to understand the authentication flow
- Ran test suite, found 3 failing tests in auth module

## What Was Learned
- The token refresh logic had a race condition on concurrent requests
- The `refreshToken()` function wasn't using a mutex

## What Was Completed
- Fixed race condition by adding async mutex to `refreshToken()`
- All 3 auth tests now pass

## Next Steps
- Consider adding integration tests for concurrent auth scenarios

## Files
- **Read:** src/auth.ts, src/auth.test.ts
- **Modified:** src/auth.ts

## Concepts
- problem-solution, how-it-works, bugfix
```

### 3. LanceDB for vector search, grep for keyword fallback

**Decision:** Use `@lancedb/lancedb` (embedded, serverless) for semantic vector search. Fall back to `grep -r` for keyword search.

**Rationale:** LanceDB is embedded (no server process like Chroma), Apache 2.0 licensed, and has a mature TypeScript API. It stores data in the local filesystem (~`/.pi-mem/lancedb/`). For keyword search, `grep -r` on markdown files is simple and effective as a fallback when the user wants exact string matches.

**Alternatives considered:**
- Chroma — requires running a server process, heavier dependency
- SQLite FTS5 — would need native modules, adds complexity
- Pure grep only — no semantic/fuzzy search capability
- Orama — in-memory, good for small datasets but doesn't persist natively

**Embedding model:** Use a small local model or an API-based model. We'll support configurable embedding via `config.json`. Default: use the OpenAI-compatible embeddings endpoint (works with most providers) or a bundled lightweight model via `@lancedb/lancedb` built-in embedding functions.

**What gets indexed:** The compressed memory files (not raw sessions). Each memory becomes a row with:
- `text` — full memory content
- `project` — project slug
- `session_id` — session identifier
- `date` — ISO date
- `concepts` — extracted concept tags
- `files` — files touched
- `vector` — embedding of the text content

### 4. Context injection via `before_agent_start`

**Decision:** On each `before_agent_start`, inject relevant past memories into the conversation as a system prompt addendum.

**Rationale:** Pi's `before_agent_start` hook lets us return both a `message` (stored in session, sent to LLM) and a `systemPrompt` modification. We inject:
1. A compact project overview from `index.md` (always)
2. The last 2-3 session summaries (recent context)
3. Any vector-search results relevant to the user's current prompt

This mirrors claude-mem's SessionStart context injection but is simpler — no worker service needed.

**Token budget:** Cap injected context at ~2000 tokens. Progressive disclosure: show titles/one-liners first, let the LLM use `mem_search` for deeper dives.

**Alternatives considered:**
- Inject only on `session_start` — misses context for follow-up prompts after compaction
- Inject into system prompt only — pollutes the system prompt, harder to manage
- No automatic injection, tools only — puts burden on the LLM to know to search

### 5. Summarization via a pi SDK subagent

**Decision:** Spawn a headless pi subagent (via `createAgentSession` from the pi SDK) to compress observations into structured memories. The subagent runs in-process with `SessionManager.inMemory()`, a custom system prompt tailored for memory compression, and no tools. This mirrors claude-mem's approach of using a separate Claude Agent SDK instance, but uses pi's own SDK instead.

**Rationale:** Claude-mem runs a dedicated Claude Agent SDK session as a background "memory worker" — it feeds raw tool observations into the worker and receives structured XML observations back. We follow the same pattern but with pi's SDK:

1. At `agent_end`, collect all observations buffered during the prompt cycle
2. Spawn (or reuse) a headless pi subagent with:
   - `SessionManager.inMemory()` — no persistence needed for the compression agent itself
   - A custom system prompt that defines the observation/summary XML format (like claude-mem's `buildInitPrompt`)
   - `tools: []` — no tools, pure text-in/text-out compression
   - A cheap/fast model (configurable, default to the user's current model)
3. Send the raw observations as a prompt to the subagent
4. Parse the structured response (summary fields) and write to the memory file
5. Embed the compressed memory text into LanceDB

The subagent is fire-and-forget from the user's perspective — it runs after `agent_end` and doesn't block the next user prompt. If it fails or times out (>15s), we fall back to storing raw observations only.

**Subagent system prompt** (inspired by claude-mem's `buildInitPrompt` and `buildSummaryPrompt`):
- Identity: "You are a memory compression agent. You observe tool executions from a coding session and produce structured summaries."
- Output format: Structured markdown with sections (Request, Investigated, Learned, Completed, Next Steps, Files, Concepts)
- Recording focus: What was BUILT/FIXED/LEARNED, not what the observer is doing
- Skip guidance: Skip routine operations (ls, empty results, package installs)

**Alternatives considered:**
- Direct LLM API call (no pi SDK) — simpler but loses pi's model management, auth storage, and retry logic
- `pi.sendUserMessage()` with `deliverAs: "followUp"` — pollutes the user's conversation with compression prompts
- Background worker process (claude-mem approach) — complex, needs process management, IPC
- No AI summarization, just store raw observations — too verbose for context injection

### 6. Project identity from git remote or cwd

**Decision:** Derive project slug from `git remote get-url origin` (normalized), falling back to the basename of cwd.

**Rationale:** Same approach as claude-mem. Git remote gives a stable project identity across different checkout locations. The slug is used as the directory name under `~/.pi-mem/projects/`.

**Normalization:** `git@github.com:user/repo.git` → `github.com-user-repo`; `https://github.com/user/repo` → `github.com-user-repo`.

### 7. Privacy filtering

**Decision:** Support `<private>...</private>` tags in tool output to exclude content from storage, plus a `.pi-mem-ignore` patterns file.

**Rationale:** Matches claude-mem's privacy model. The `<private>` tags are stripped before storing observations. The `.pi-mem-ignore` file (in project root or `~/.pi-mem/`) uses gitignore-style patterns to exclude entire files or directories from observation capture.

## Risks / Trade-offs

**[Markdown doesn't scale to thousands of sessions]** → Mitigated by aggressive summarization and vector search. The `index.md` rolling summary keeps recent context small. Old session files can be archived/compressed. For v1, this is acceptable — most projects won't have thousands of sessions.

**[LanceDB adds a native dependency]** → LanceDB ships prebuilt binaries for major platforms. If it fails to install, the extension degrades gracefully — vector search is disabled, grep keyword search still works.

**[Summarization adds latency at agent_end]** → Use a fast/cheap model (e.g., Haiku, GPT-4o-mini) for summarization. If the call takes >10s, skip and store raw observations only. The user can re-summarize later.

**[Embedding model choice affects search quality]** → Start with LanceDB's built-in embedding functions. Allow users to configure their preferred model via `config.json`.

**[Context injection may use tokens the user didn't ask for]** → Cap at ~2000 tokens. Make injection configurable (on/off, token budget). Show a subtle indicator when memories are injected.

## Open Questions

- **Embedding model default:** Should we default to a local model (faster, no API cost) or an API-based model (better quality)? LanceDB supports both via its embedding functions API.
- **Summarization model:** Should we use the same model the user has selected in pi, or always use a cheap model? Using the user's model is simpler but may be expensive.
- **Compaction integration:** When pi compacts a conversation, should we automatically capture that compaction summary as a memory too?
- **Cross-session deduplication:** If the user works on the same thing across multiple sessions, how do we avoid redundant memories? The `index.md` rolling summary helps, but we may need explicit dedup logic.
