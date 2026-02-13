## 1. Mode Configuration & XML Parsing

- [x] 1.1 Create `mode-config.ts` with TypeScript types (`ObservationType`, `ObservationConcept`, `ModeConfig`) and a static `CODE_MODE` constant defining 6 observation types (bugfix, feature, refactor, change, discovery, decision), 7 concept categories (how-it-works, why-it-exists, what-changed, problem-solution, gotcha, pattern, trade-off), and all prompt templates (system identity, observer role, recording focus, skip guidance, XML format template)
- [x] 1.2 Create `xml-parser.ts` with `parseObservation()` function that extracts type, title, subtitle, facts[], narrative, concepts[], files_read[], files_modified[] from an `<observation>` XML block using regex. Validate type against the fixed taxonomy (fallback to "change"). Filter concepts to valid taxonomy (drop invalid). Handle missing/empty fields gracefully (return null/empty arrays)

## 2. Observer Agent

- [x] 2.1 Create `observer-agent.ts` with `extractObservation()` function that spawns `pi --mode json --no-session --no-tools` with the observer system prompt and a user prompt containing full tool_name, tool_input, and tool_output. Reuse the `runSubAgent()` pattern from `compression-agent.ts`. Parse the XML response with `parseObservation()`. Return structured observation or null on failure
- [x] 2.2 Add `buildObserverPrompt()` function that constructs the observer prompt from `CODE_MODE` config: system identity + observer role + recording focus + skip guidance + XML format template + the actual tool execution data (`<observed_from_primary_session>` wrapper with tool_name, parameters, outcome)
- [x] 2.3 Add skip logic: return null immediately for pi-mem's own tools (search, timeline, get_observations, save_memory), outputs shorter than 50 chars, and privacy-filtered paths. No LLM call made for skipped observations

## 3. LanceDB Schema (Clean Break)

- [x] 3.1 Update `observation-store.ts`: on `initStore()`, drop the existing `observations` table if it exists and create a new table with the structured schema (id, session_id, project, type, obs_type, timestamp, tool_name, title, subtitle, facts, narrative, concepts, files_read, files_modified, vector). Add a schema version marker so future changes can detect stale schemas
- [x] 3.2 Update all write functions (`addObservation`, `addPrompt`, `addSummary`, `addManualMemory`) to use the new schema columns. Replace single `text` column writes with `narrative`, `subtitle`, `facts`, `files_read`, `files_modified` columns. `addPrompt` stores user prompt text in `narrative`
- [x] 3.3 Update all read functions (`getSessionObservations`, `ftsSearch`, `timelineSearch`, `getObservationsByIds`) to select and return the new structured columns. FTS searches on `narrative` column. Timeline preview uses subtitle instead of text_preview slice

## 4. Config & Types

- [x] 4.1 Add `observerModel` to `PiMemConfig` interface and `DEFAULTS` in `config.ts`. Resolution order: `observerModel` → `summaryModel` → session model
- [x] 4.2 Update `ObservationRow` and result types (`IndexResult`, `TimelineResult`, `FullResult`) in `observation-store.ts` to reflect new columns (add obs_type, subtitle, facts, narrative, files_read, files_modified; remove text, files, concepts as comma-separated)

## 5. Integration (index.ts tool_result handler)

- [x] 5.1 Rewrite `tool_result` handler in `index.ts`: remove `truncateOutput()` call. Instead, pass full output + tool_name + input to `extractObservation()` from `observer-agent.ts`. Run extraction async (fire-and-forget). On success, store structured observation. On failure, store fallback observation with truncated raw text as narrative and `"{tool_name}: {input_summary}"` as title
- [x] 5.2 Merge deterministic file extraction (`extractFiles()` from tool input) with observer-extracted files. Deterministic files are ground truth; observer files are supplementary. Combine into files_read/files_modified arrays before storing

## 6. Summarization (compression-agent.ts)

- [x] 6.1 Update `summarize()` in `compression-agent.ts` to build the prompt from structured observation fields (title + narrative) instead of raw text sliced to 1000 chars. Remove the `obs.output.slice(0, 1000)` and `JSON.stringify(obs.input).slice(0, 500)` lines. Use full narrative since it's already LLM-compressed
- [x] 6.2 Update `extractFallbackSummary()` to use structured fields (title, obs_type) instead of raw tool_name

## 7. Search & Context Tools

- [x] 7.1 Update `tools.ts` to return structured fields in search results: add subtitle, obs_type to index results. Update get_observations to return facts, narrative, concepts, files_read, files_modified as structured data (parsed JSON arrays)
- [x] 7.2 Update `context-injection.ts` to build injected context from structured observation/summary fields instead of raw text

## 8. Cleanup

- [x] 8.1 Remove `truncateOutput()` from `observer.ts` (or keep only for fallback path). Remove the `Observation` interface from `observer.ts` since it's replaced by structured types
- [x] 8.2 Delete `~/.pi-mem/lancedb/` directory contents on first run with new schema (handled by initStore dropping old table) (or detect old schema and wipe). Log a message: "pi-mem: migrated to structured observations, previous data cleared"
- [x] 8.3 Update `observer.ts` to only export `stripPrivateTags()` (privacy filtering still needed). Remove unused exports
