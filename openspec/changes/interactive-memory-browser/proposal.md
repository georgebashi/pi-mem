## Why

Memories in pi-mem are currently write-only from the user's perspective — observations and summaries accumulate but there's no way to see what the agent actually sees, browse the underlying data, or fix bad memories. Users can't verify that context injection is working well or that semantic search returns useful results. An interactive TUI browser would let users peer inside the agent's brain — seeing exactly what gets injected, testing how search works, and curating the memory store.

## What Changes

- Add an interactive memory browser accessible via `/mem-browse` command
- Open with an "agent's view" showing exactly what would be injected into context for the current project
- Let users drill from injected context → summaries → observations → prompts, mirroring the layered data model
- Support both FTS keyword search and semantic vector search, so users can test search quality
- Allow editing memory text/title/concepts with re-embedding on edit
- Allow deleting individual memories
- Add observation store functions for update, delete, and re-embedding operations

## Capabilities

### New Capabilities
- `memory-browser`: Interactive TUI component that lets users peer inside the agent's memory. Opens with the injected context view, supports layered navigation (summaries → observations), FTS and vector search, editing with re-embedding, and deletion. Registers as `/mem-browse` command.
- `observation-crud`: Update and delete operations on individual observation rows in LanceDB, including re-embedding when narrative content changes. Extends the existing read-only store API.

### Modified Capabilities
<!-- None — the browser reuses existing search/query functions internally -->

## Impact

- **Code**: New files for the browser TUI component and CRUD store operations; modifications to `observation-store.ts` for update/delete/re-embed exports; new command registration in `index.ts`
- **APIs**: New exported functions `updateObservation()`, `deleteObservation()`, `reembedObservation()` from observation-store
- **Dependencies**: No new dependencies — uses pi's built-in TUI component API (`ctx.ui.custom()`, `Text`, `Container`, etc.)
- **Data**: LanceDB table rows can now be mutated/deleted by the user; edited summaries and manual saves get fresh embedding vectors
