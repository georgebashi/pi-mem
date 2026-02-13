## Why

pi-mem currently stores tool outputs by naively truncating to 4000 chars (`slice(0, N)`), then further truncating to 1000 chars when building the summarization prompt. For a typical 19K-char file read, the LLM summarizer sees only the first 26 lines — usually just imports and type definitions — and produces empty or inaccurate summaries. The core problem is architectural: raw text is stored and meaning is extracted later from a heavily truncated version. claude-mem solves this by running a dedicated LLM observer that reads the **full** tool output at capture time and extracts structured observations (title, facts, narrative, concepts, files). We should adopt the same architecture.

## What Changes

- **Replace raw text storage with structured observation extraction.** Instead of storing truncated tool output as text, send each tool result to a dedicated LLM observer that extracts structured fields: type, title, subtitle, facts, narrative, concepts, files_read, files_modified.
- **Add an LLM observer agent** that receives full tool outputs at `tool_result` time and produces structured XML observations, following claude-mem's observer pattern.
- **Add a mode/prompt configuration system** that defines observation types (bugfix, feature, discovery, etc.), concept taxonomies, and XML output format templates, following claude-mem's mode config pattern.
- **Modify the LanceDB schema** to store structured observation fields (title, subtitle, facts as JSON array, narrative, concepts as JSON array, files_read, files_modified) instead of a single `text` column with raw output.
- **Replace the end-of-session summarization model.** Instead of one LLM call at `agent_end` that tries to compress all observations, generate per-observation structured data at capture time. Session summaries become a separate, lighter step that aggregates already-structured observations.
- **Remove the truncation pipeline.** `truncateOutput()` in `observer.ts` and the 1000-char slice in `compression-agent.ts` are no longer needed — the LLM observer handles compression naturally.
- **Adapt the 3-layer search/timeline/get_observations API** to return structured fields instead of raw text. Search indexes on title, narrative, and facts for better FTS relevance.

## Capabilities

### New Capabilities
- `observation-extraction`: LLM-powered observation extraction from full tool outputs at capture time. Includes observer agent, XML parsing, mode/prompt configuration, and structured storage.

### Modified Capabilities
<!-- No existing specs to modify — this is the first spec -->

## Impact

- **Files changed:** `observer.ts` (truncation removed, extraction added), `compression-agent.ts` (per-observation extraction replaces end-of-session-only summarization), `observation-store.ts` (schema changes for structured fields), `index.ts` (tool_result handler sends to observer LLM instead of truncating), `config.ts` (new observer model config), `tools.ts` (search/timeline return structured data), `context-injection.ts` (inject structured observations).
- **LLM cost increase:** One LLM call per tool execution instead of one per session. Mitigated by using a fast/cheap model (e.g., Haiku) for observation extraction. Can be further mitigated by batching multiple tool results.
- **Dependencies:** Requires a pi sub-agent spawn or direct LLM API call for observation extraction. No new npm dependencies.
- **Migration:** Existing observations in LanceDB use the old schema (single `text` column). Need a migration strategy — either backfill or treat old observations as legacy read-only data.
- **Breaking changes:** The observation store schema changes. Existing stored observations will need migration or coexistence handling.
