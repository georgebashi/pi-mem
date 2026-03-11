## 1. Observation Store CRUD Operations

- [x] 1.1 Add `deleteObservation(store, id)` function to `observation-store.ts` — deletes a single row by ID using `table.delete()`
- [x] 1.2 Add `getObservationType(store, id)` function — returns the `type` field for a row, or null
- [x] 1.3 Add `updateObservation(store, id, fields)` function — updates title, narrative, and/or concepts; when narrative changes on a summary/manual row, recomputes the embedding vector via `store.embed()` and updates the vector column
- [x] 1.4 Add `listObservations(store, options)` function — returns paginated `IndexResult[]` with project/type filtering and sort order (desc/asc)
- [x] 1.5 Add `countObservations(store, options)` function — returns total row count matching project/type filters
- [x] 1.6 Add `getObservationById(store, id)` convenience function — returns a single `FullResult | null`
- [x] 1.7 Export all new functions from `observation-store.ts`

## 2. Memory Browser — Injected Context View (Home)

- [x] 2.1 Create `memory-browser.ts` with the main browser component class implementing `Component` interface (render, handleInput, invalidate)
- [x] 2.2 Implement the injected context home view: render the project memory index (recent summaries list with dates/session IDs) and workflow guidance, matching the output of `buildInjectedContext()`
- [x] 2.3 Add test-prompt input: user can type a prompt to see what semantic search results would be injected for that query; show results below the memory index
- [x] 2.4 Handle the no-embeddings case: show the memory index with a note that semantic search is unavailable

## 3. Memory Browser — Layered Navigation

- [x] 3.1 Implement tab bar / header showing the four top-level views: [1] Injected Context, [2] Summaries, [3] Timeline, [4] All Memories. Number keys switch views.
- [x] 3.2 Implement Summaries view: list of all session summaries for the current project with preview pane
- [x] 3.3 Implement Session drill-down: pressing enter on a summary opens the Session view showing that session's observations chronologically (queried by session_id). Escape/backspace returns to Summaries.
- [x] 3.4 Implement Timeline view: show chronological neighbourhood around an anchor memory using `timelineSearch()`. Highlight the anchor item visually. Default depth of 5 before/after. `+`/`-` keys adjust depth and reload.
- [x] 3.5 Implement timeline entry: pressing `T` on any selected item in any list view (summaries, session, all memories, or timeline itself) opens the timeline anchored on that item. Pressing `T` within timeline re-anchors.
- [x] 3.6 Implement All Memories view: flat list of all rows (observation, prompt, summary, manual) with type filtering (`t` cycles types)

## 4. Memory Browser — Two-Pane Layout

- [x] 4.1 Implement two-pane layout: list pane (~40% width) and preview pane (~60% width) for terminals ≥ 100 cols
- [x] 4.2 Implement stacked fallback: list on top, preview on bottom for terminals < 100 cols
- [x] 4.3 Implement scrollable list with compact display (type badge, date, truncated title) and keyboard navigation (up/down, page up/page down)
- [x] 4.4 Implement preview pane showing full content (title, type, timestamp, session, project, concepts, files, narrative) with scroll support (shift+up/down)

## 5. Memory Browser — Search

- [x] 5.1 Implement FTS keyword search: press `/` to open search input, type query, enter to search, escape to clear
- [x] 5.2 Implement semantic vector search: press `v` to open vector search input, enter to search, show results ranked by similarity. Show "Embeddings not configured" notification when unavailable.

## 6. Memory Browser — Edit and Delete

- [x] 6.1 Implement edit: press `e` to open editor with current title and narrative; on save, call `updateObservation()` (which handles re-embedding); refresh preview
- [x] 6.2 Implement delete: press `d` to show confirmation dialog via `ctx.ui.confirm()`; on confirm, call `deleteObservation()` and refresh list
- [x] 6.3 Show "Saving..." indicator during edit save (covers re-embedding latency)

## 7. Memory Browser — Chrome and Navigation

- [x] 7.1 Implement help bar at the bottom showing contextual keyboard shortcuts per view (include `T timeline`, `+/- depth` in timeline view)
- [x] 7.2 Implement exit: `q` or escape (when not in search/edit) closes the browser
- [x] 7.3 Implement pagination: load initial 100 items per list view, auto-load more when scrolling near bottom

## 8. Command Registration and Integration

- [x] 8.1 Register `/mem-browse` command in `index.ts` — check store availability, launch browser component via `ctx.ui.custom()`
- [x] 8.2 Pass store instance, project slug, config, embed function, and theme to the browser component
- [x] 8.3 Wire up CRUD operations: browser calls `updateObservation()`, `deleteObservation()` for mutations; calls `listObservations()`, `ftsSearch()`, `semanticSearch()`, `timelineSearch()`, `getObservationById()` for data; calls `getRecentSummaries()` and `buildInjectedContext()` for the home view

## 9. Testing and Polish

- [ ] 9.1 Test injected context view: verify it matches `buildInjectedContext()` output for the project
- [ ] 9.2 Test test-prompt input: type a prompt, verify semantic results appear
- [ ] 9.3 Test layered navigation: open summaries, drill into session from a summary (see observations), open timeline from any item, switch to all memories
- [ ] 9.4 Test timeline view: verify anchor is highlighted, depth adjustment works, re-anchoring works, edge-of-data handling works
- [ ] 9.5 Test edit flow: edit a summary's narrative, verify re-embedding occurs (vector changes), verify FTS and vector search find updated content
- [ ] 9.6 Test delete flow: delete a memory, verify it disappears from list and store
- [ ] 9.7 Test vector search: search semantically, verify results are ranked by relevance
- [ ] 9.8 Test empty store and no-embeddings cases
- [ ] 9.9 Test narrow terminal layout switching
