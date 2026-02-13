## Context

pi-mem is a pi extension that captures tool observations during coding sessions, stores them in LanceDB, generates AI-powered session summaries, and injects relevant context into future sessions. It currently uses a **store-then-summarize** pattern: raw tool output is truncated to 4000 chars at capture time, stored as plain text, then further truncated to 1000 chars when building the summarization prompt. This means the LLM summarizer sees ~5% of a typical file read, producing empty or inaccurate summaries.

claude-mem solves this with an **observe-then-extract** architecture: a dedicated LLM observer agent receives full tool outputs and extracts structured observations (type, title, facts, narrative, concepts, files) in real time. No raw text is stored — only the LLM-extracted structured data.

pi-mem already has the infrastructure to spawn LLM sub-agents (`runSubAgent` in `compression-agent.ts`), a LanceDB store with FTS and vector search, and a 3-layer progressive disclosure API. This change replaces the truncation + raw text storage with LLM-powered structured extraction at capture time.

### Current Data Flow
```
tool_result → truncateOutput(4000) → store raw text in LanceDB
agent_end   → read observations → slice(1000) → LLM summarizes → store summary
```

### Target Data Flow
```
tool_result → queue observation → observer LLM extracts structured data → store structured fields
agent_end   → read structured observations → lightweight summary aggregation → store summary
```

## Goals / Non-Goals

**Goals:**
- Full tool output visibility for the extraction LLM — no information loss before extraction
- Structured observation storage: type, title, subtitle, facts, narrative, concepts, files_read, files_modified
- Observation types and concepts follow claude-mem's taxonomy (bugfix, feature, discovery, decision, refactor, change) and (how-it-works, what-changed, problem-solution, gotcha, pattern, trade-off)
- Session summaries still produced at `agent_end`, but as lightweight aggregation of already-structured observations
- 3-layer search API continues to work, returning structured fields instead of raw text
- Graceful degradation: if the observer LLM fails, fall back to the current raw-text-with-truncation approach

**Non-Goals:**
- Persistent background worker daemon (claude-mem's architecture). pi-mem runs as an in-process extension; the observer runs as a spawned sub-agent per observation.
- Message queue persistence (claude-mem uses SQLite-backed queues for crash recovery). pi-mem's fire-and-forget pattern is acceptable since observations are ephemeral until stored.
- Multi-provider support (claude-mem supports Claude SDK, Gemini, OpenRouter). pi-mem uses `pi --mode json` to leverage whatever model the user has configured.
- Real-time web UI or SSE broadcasting.
- Migration of existing observations — old rows remain as-is with a `text` column; new rows use structured fields.

## Decisions

### 1. Observer LLM: pi sub-agent spawn (reuse existing pattern)

**Decision:** Spawn `pi --mode json --no-session --no-tools` per observation, same as the existing `runSubAgent()` in `compression-agent.ts`.

**Alternatives considered:**
- Direct LLM API call (lower latency, but requires managing provider auth, model selection, and API differences)
- Persistent child process with stdin/stdout streaming (lower overhead per call, but complex lifecycle management)

**Rationale:** The sub-agent pattern already works, handles model selection through pi's config, and keeps pi-mem provider-agnostic. Per-observation spawn overhead (~200-500ms) is acceptable since tool executions are seconds apart.

### 2. Observation extraction: per tool_result, not batched

**Decision:** Extract one observation per `tool_result` event. Don't batch.

**Alternatives considered:**
- Batch N observations and extract together (fewer LLM calls, but adds latency and complexity with buffering/flushing)
- Extract only at `agent_end` (current approach — loses information)

**Rationale:** Per-observation extraction is simpler, gives the LLM full context for each tool execution, and matches claude-mem's proven approach. Cost is mitigated by using a fast/cheap model (Haiku).

### 3. Fire-and-forget extraction, no fallback

**Decision:** Run observation extraction asynchronously. If the LLM fails or times out, the observation is silently dropped. No raw-text fallback. Don't block the main session.

**Rationale:** Memory capture must never degrade the user's coding experience. claude-mem takes the same approach — if the observer fails, the observation is lost. This is simpler and avoids storing low-quality truncated text that pollutes the memory.

### 4. XML output format with parsing

**Decision:** Use claude-mem's XML format for observer output. Parse with regex (same approach as claude-mem's `parser.ts`).

**Format:**
```xml
<observation>
  <type>discovery</type>
  <title>Short title</title>
  <subtitle>One sentence (max 24 words)</subtitle>
  <facts>
    <fact>Specific factual statement</fact>
    <fact>Another fact</fact>
  </facts>
  <narrative>Full context paragraph</narrative>
  <concepts>
    <concept>how-it-works</concept>
  </concepts>
  <files_read>
    <file>src/observer.ts</file>
  </files_read>
  <files_modified>
    <file>src/index.ts</file>
  </files_modified>
</observation>
```

**Alternatives considered:**
- JSON output (more fragile with LLMs — they often produce invalid JSON)
- Markdown with section headers (harder to parse reliably)

**Rationale:** XML is well-suited for LLM output: forgiving parsing, clear delimiters, works well with regex extraction. claude-mem has proven this works at scale.

### 5. Skip logic: don't extract for low-value tool executions

**Decision:** Skip observer LLM calls for routine operations, same as claude-mem's skip guidance:
- Empty or trivial outputs (< 50 chars)
- Repeated `ls` or `find` with no meaningful results
- Package install outputs
- The observer's own system prompt tells it when to produce empty output

Additionally, skip tools that are pi-mem's own tools (search, timeline, get_observations, save_memory) to avoid meta-observations.

### 6. LanceDB schema: clean break, new table

**Decision:** Drop the existing `observations` table entirely and create a new one with a structured schema. Delete `~/.pi-mem/lancedb/` on first run to start fresh. No backward compatibility with old data.

**New schema:**
```
id:             string (UUID prefix)
session_id:     string
project:        string
type:           string (observation type: "observation" | "prompt" | "summary" | "manual")
obs_type:       string (extracted type: "bugfix" | "feature" | "discovery" | "decision" | "refactor" | "change")
timestamp:      string (ISO 8601)
tool_name:      string
title:          string (extracted title)
subtitle:       string (one-sentence explanation)
facts:          string (JSON array of fact strings)
narrative:      string (full context paragraph, also used for FTS)
concepts:       string (JSON array: "how-it-works", "what-changed", etc.)
files_read:     string (JSON array of file paths)
files_modified: string (JSON array of file paths)
vector:         float32[1536] (embedding, zero vector sentinel for rows without)
```

**Rationale:** No migration complexity, no column overloading, no ambiguity about what `text` means. Clean slate matches the new architecture cleanly.

### 7. Mode configuration: static JSON, single mode

**Decision:** Ship a single `code.json` mode config embedded in the source (not a separate file), defining observation types, concepts, and prompt templates. Don't implement multi-mode support.

**Alternatives considered:**
- External JSON files like claude-mem (overkill for a single mode)
- Hardcoded prompts in TypeScript (less maintainable)

**Rationale:** pi-mem only needs one mode (code development). Defining it as a typed constant gives type safety and easy modification without a file loading system.

### 8. Session summaries: lightweight aggregation of structured observations

**Decision:** At `agent_end`, build the summarization prompt from structured observation fields (title + narrative) instead of raw text. The per-observation character budget problem disappears because narratives are already LLM-compressed.

The summarization LLM call at `agent_end` is kept but simplified — it aggregates already-extracted observations rather than trying to make sense of truncated raw text.

### 9. Observer model configuration

**Decision:** Add `observerModel` to `PiMemConfig`. Default: use `summaryModel` if set, then fall back to the current session model. Users who want cheap extraction can set this to Haiku.

## Risks / Trade-offs

- **[LLM cost increase]** One LLM call per tool execution vs. one per session. → Mitigation: use cheap/fast model (Haiku). Typical session has 10-30 tool calls. At ~$0.001/call with Haiku, total cost is ~$0.01-0.03/session.
- **[Latency per tool_result]** 1-3s per observation extraction. → Mitigation: fire-and-forget (async). The main session is never blocked. Observations may arrive slightly delayed.
- **[Observer LLM quality]** The observer may miss important details or hallucinate facts. → Mitigation: the prompt is heavily constrained with specific types and concepts. Facts are verifiable. Files are cross-checked with deterministic extraction (existing `extractFiles()` logic).
- **[Sub-agent spawn overhead]** Each `pi --mode json` spawn has process startup cost. → Mitigation: acceptable for the 1-3s observation window. If this becomes a bottleneck, could switch to a persistent child process in a future iteration.
- **[Schema migration]** Existing observations are dropped. → Mitigation: intentional clean break. Old data is from today's debugging sessions only and has no long-term value. Users start fresh with higher-quality structured observations.

## Open Questions

- **Batch threshold:** Should very rapid tool executions (e.g., 5 reads in 2 seconds) be batched into a single observer call? claude-mem handles this via its message queue. For v1, we'll process each individually and revisit if cost/latency is an issue.
- **Observer context window:** Should the observer see only the current tool execution, or also recent observations for continuity? claude-mem maintains a conversation history with the observer. For v1, each observation is independent (stateless). The session summary provides continuity.
- **Files cross-check:** Should we trust the LLM's file extraction or always override with deterministic extraction from tool input? Current plan: use deterministic `extractFiles()` as ground truth, supplement with LLM-extracted files that weren't in the input (e.g., files mentioned in bash output).
