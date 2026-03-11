# Memory Browser UI Mockups

These mockups define the target look and feel for the interactive memory browser TUI.
Assuming ~120 column terminal width for wide layout.

## View 1: Injected Context (Home)

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│ [1 Context]  2 Summaries  3 Timeline  4 All Memories                    github.com-georgebashi-pi-mem   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                          │
│  What the agent sees                                                                                     │
│  ───────────────────                                                                                     │
│                                                                                                          │
│  ## Project Memory (github.com-georgebashi-pi-mem)                                                       │
│                                                                                                          │
│  - 2026-02-17 [9da3ab0e]: Design and specify the Interactive Memory Browser feature for the pi-mem...    │
│  - 2026-02-17 [76f57ceb]: Session with tools: read                                                      │
│  - 2026-02-17 [320e3dd0]: Session with tools: read, bash, write                                         │
│                                                                                                          │
│  ### Memory Search Tools                                                                                 │
│                                                                                                          │
│  3-LAYER WORKFLOW (ALWAYS FOLLOW):                                                                       │
│  1. search(query) → Get index with IDs (~50-100 tokens/result)                                           │
│  2. timeline(anchor=ID) → Get context around interesting results                                         │
│  3. get_observations([IDs]) → Fetch full details ONLY for filtered IDs                                   │
│  NEVER fetch full details without filtering first. 10x token savings.                                    │
│                                                                                                          │
│                                                                                                          │
│                                                                                                          │
│  ─── Test semantic search ───────────────────────────────────────────                                    │
│  Prompt: █                                                                                               │
│  Type a prompt to see what semantic results would be injected                                             │
│                                                                                                          │
│                                                                                                          │
│                                                                                                          │
│                                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1-4 views  / search  v vector  q quit                                                                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## View 1: After typing a test prompt

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│ [1 Context]  2 Summaries  3 Timeline  4 All Memories                    github.com-georgebashi-pi-mem   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                          │
│  What the agent sees                                                                                     │
│  ───────────────────                                                                                     │
│                                                                                                          │
│  ## Project Memory (github.com-georgebashi-pi-mem)                                                       │
│                                                                                                          │
│  - 2026-02-17 [9da3ab0e]: Design and specify the Interactive Memory Browser feature for the pi-mem...    │
│  - 2026-02-17 [76f57ceb]: Session with tools: read                                                      │
│  - 2026-02-17 [320e3dd0]: Session with tools: read, bash, write                                         │
│                                                                                                          │
│  ### Relevant: 2026-02-17 [9da3ab0e]                                                                    │
│  # Session Summary                                                                                       │
│  **Project:** github.com-georgebashi-pi-mem                                                              │
│  **Date:** 2026-02-17                                                                                    │
│  **Concepts:** feature, architecture, specification, design, memory-system...                             │
│  ## Request                                                                                              │
│  Design and specify the Interactive Memory Browser feature for the pi-mem persistent memory system...     │
│                                                                                                          │
│  ### Memory Search Tools                                                                                 │
│  3-LAYER WORKFLOW (ALWAYS FOLLOW):  ...                                                                  │
│                                                                                                          │
│  ─── Test semantic search ───────────────────────────────────────────                                    │
│  Prompt: memory browser design█                                                                          │
│  ↑ Showing results for "memory browser design"                                                           │
│                                                                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1-4 views  / search  v vector  enter clear prompt  q quit                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## View 2: Summaries

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Context  [2 Summaries]  3 Timeline  4 All Memories                   github.com-georgebashi-pi-mem   │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│  Summaries (3)                                       │ # Session Summary                                │
│                                                      │                                                   │
│ ▸ sum  02-17  Design and specify the Interac…  [9da… │ **Project:** github.com-georgebashi-pi-mem        │
│   sum  02-17  Session with tools: read         [76f… │ **Date:** 2026-02-17                              │
│   sum  02-17  Session with tools: read, bash…  [320… │ **Session:** 9da3ab0e                             │
│                                                      │ **Concepts:** feature, architecture,              │
│                                                      │   specification, design, memory-system,            │
│                                                      │   ui-component, database-mutation,                 │
│                                                      │   progressive-disclosure, token-efficiency,         │
│                                                      │   crud-operations, lancedb, tui, usability          │
│                                                      │                                                   │
│                                                      │ ## Request                                        │
│                                                      │ Design and specify the Interactive Memory          │
│                                                      │ Browser feature for the pi-mem persistent          │
│                                                      │ memory system, addressing the gap where            │
│                                                      │ users cannot browse, audit, edit, or delete        │
│                                                      │ stored observations.                               │
│                                                      │                                                   │
│                                                      │ ## What Was Investigated                           │
│                                                      │ - Current pi-mem architecture                      │
│                                                      │ - Observation store schema and API                 │
│                                                      │ - Token-efficient search workflow                  │
│                                                      │ - pi agent extension system                        │
│                                                      │ ...                                                │
│                                                      │                                                   │
│                                                      │ ## Files                                           │
│                                                      │ Read: 28 files  Modified: 8 files                  │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ ↑↓ navigate  enter session  T timeline  / search  v vector  e edit  d delete  q quit                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## View 2 → Session drill-down (enter on a summary)

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Context  2 Summaries ▸ [Session 9da3ab0e]  3 Timeline  4 All Memories                                │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│  Session 9da3ab0e observations (12)                  │ ## Read: context-injection.ts                     │
│                                                      │                                                   │
│   obs  02-17  Read pi-mem Interactive Memory…        │ **Type:** observation (code-read)                 │
│   obs  02-17  Read package.json                      │ **Tool:** read                                    │
│   obs  02-17  Read README.md                         │ **Timestamp:** 2026-02-17 23:21:54                │
│   obs  02-17  openspec new change interactive…       │                                                   │
│   obs  02-17  openspec status --change interac…      │ Context injection for pi-mem.                     │
│   obs  02-17  openspec instructions proposal…        │ Queries LanceDB for recent summaries,             │
│   obs  02-17  Read index.ts                          │ prompt-aware semantic search, and injects          │
│   obs  02-17  Read tools.ts                          │ 3-layer workflow guidance.                         │
│   obs  02-17  Read observation-store.ts              │                                                   │
│ ▸ obs  02-17  Read context-injection.ts              │ **Facts:**                                        │
│   obs  02-17  Read extensions.md                     │ - buildInjectedContext() builds what agent         │
│   obs  02-17  Read tui.md                            │   sees at before_agent_start                      │
│                                                      │ - Includes recent summaries index,                │
│                                                      │   semantic search results, and workflow            │
│                                                      │   guidance                                         │
│                                                      │ - Token budget controls total injection size       │
│                                                      │                                                   │
│                                                      │ **Files Read:**                                   │
│                                                      │   context-injection.ts                             │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ ↑↓ navigate  T timeline  esc back to summaries  e edit  d delete  q quit                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## View 3: Timeline (after pressing T on an item)

The `▶` marker indicates the anchor item; `▸` indicates the current selection.

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Context  2 Summaries  [3 Timeline]  4 All Memories                         depth: 5  anchor: a3f08c  │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│  Timeline around "Read context-injection.ts"         │ ## openspec instructions proposal                 │
│                                                      │                                                   │
│   obs  02-17  Read README.md                   [320… │ **Type:** observation (tool-use)                  │
│   obs  02-17  openspec new change…             [320… │ **Tool:** bash                                    │
│   obs  02-17  openspec status --change…        [320… │ **Timestamp:** 2026-02-17 23:22:31                │
│ ▸ obs  02-17  openspec instructions proposal…  [320… │ **Session:** 320e3dd0                             │
│   obs  02-17  Read index.ts                    [320… │                                                   │
│ ▶ obs  02-17  Read context-injection.ts        [320… │ Fetched openspec instructions for the             │
│   obs  02-17  Read extensions.md               [320… │ proposal artifact of the interactive-memory-      │
│   obs  02-17  Read tui.md                      [320… │ browser change. Template includes sections:        │
│   obs  02-17  Wrote proposal.md                [320… │ Why, What Changes, Capabilities, Impact.           │
│   obs  02-17  openspec status --change…        [320… │                                                   │
│   obs  02-17  Wrote design.md                  [320… │ **Facts:**                                        │
│                                                      │ - Schema is spec-driven with proposal →            │
│                                                      │   design → specs → tasks pipeline                  │
│                                                      │ - applyRequires: ["tasks"]                         │
│                                                      │ - Proposal unlocks design and specs                │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
│                                                      │                                                   │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ ↑↓ navigate  T re-anchor  +/- depth  / search  e edit  d delete  esc back  q quit                       │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## View 4: All Memories

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Context  2 Summaries  3 Timeline  [4 All Memories]                   Filter: all  Total: 47          │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│  All memories (47)                                   │ ## Database choice: PostgreSQL                    │
│                                                      │                                                   │
│ ▸ mem  02-17  Database choice: PostgreSQL      [c5f… │ **Type:** manual                                 │
│   sum  02-17  Design and specify the Interac…  [9da… │ **Timestamp:** 2026-02-17 22:15:00               │
│   obs  02-17  Read context-injection.ts        [a3f… │ **Session:** 320e3dd0                             │
│   obs  02-17  Read observation-store.ts        [b4e… │ **Concepts:** decision, architecture              │
│   obs  02-17  Read tools.ts                    [d6g… │                                                   │
│   obs  02-17  Read index.ts                    [e7h… │ Decided to use PostgreSQL instead of              │
│   prm  02-17  read the pi-mem idea and fast…   [f8i… │ MongoDB for the user service because we           │
│   sum  02-17  Session with tools: read         [76f… │ need ACID transactions for the payment            │
│   obs  02-17  Read observation-crud spec       [g9j… │ processing pipeline. MongoDB's eventual           │
│   obs  02-17  Read tasks.md                    [h0k… │ consistency model doesn't meet our                │
│   obs  02-17  Read proposal.md                 [i1l… │ requirements for financial data integrity.         │
│   obs  02-17  Read design.md                   [j2m… │                                                   │
│   prm  02-17  continue working on the memory…  [k3n… │                                                   │
│   sum  02-17  Session with tools: read, bash…  [320… │                                                   │
│   obs  02-17  openspec new change…             [l4o… │                                                   │
│   obs  02-17  Read pi-mem Interactive Memory…  [m5p… │                                                   │
│   prm  02-17  read the idea and fast-forward…  [n6q… │                                                   │
│   ...                                                │                                                   │
│                                                      │                                                   │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ ↑↓ navigate  t filter type  T timeline  / search  v vector  e edit  d delete  q quit                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## View 4: With type filter active

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Context  2 Summaries  3 Timeline  [4 All Memories]                   Filter: summary  Total: 3       │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│  Summaries only (3)                                  │ ...                                               │
│                                                      │                                                   │
│ ▸ sum  02-17  Design and specify the Interac…  [9da… │                                                   │
│   sum  02-17  Session with tools: read         [76f… │                                                   │
│   sum  02-17  Session with tools: read, bash…  [320… │                                                   │
│                                                      │                                                   │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ ↑↓ navigate  t filter type (→prompt)  T timeline  / search  v vector  e edit  d delete  q quit           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Vector search results (from any list view, press v)

Similarity score replaces the ID column in vector search results.

```
┌─ pi-mem browser ─────────────────────────────────────────────────────────────────────────────────────────┐
│  1 Context  2 Summaries  3 Timeline  [4 All Memories]                   Vector: "auth flow"  Results: 3 │
├──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│  Vector search: "auth flow"                          │ ...                                               │
│                                                      │                                                   │
│ ▸ sum  02-17  Design and specify the Interac…  0.82  │                                                   │
│   mem  02-17  Database choice: PostgreSQL       0.61  │                                                   │
│   sum  02-17  Session with tools: read, bash…  0.45  │                                                   │
│                                                      │                                                   │
├──────────────────────────────────────────────────────┴───────────────────────────────────────────────────┤
│ ↑↓ navigate  T timeline  esc clear search  e edit  d delete  q quit                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Narrow terminal (< 100 cols) — stacked layout

```
┌─ pi-mem browser ──────────────────────────────────────────────┐
│  1 Context  [2 Summaries]  3 Timeline  4 All                  │
├───────────────────────────────────────────────────────────────┤
│  Summaries (3)                                                │
│ ▸ sum  02-17  Design and specify the Inte…  [9da…             │
│   sum  02-17  Session with tools: read      [76f…             │
│   sum  02-17  Session with tools: read, b…  [320…             │
├───────────────────────────────────────────────────────────────┤
│ # Session Summary                                             │
│ **Project:** github.com-georgebashi-pi-mem                    │
│ **Date:** 2026-02-17                                          │
│ **Session:** 9da3ab0e                                         │
│ **Concepts:** feature, architecture, spec…                    │
│                                                               │
│ ## Request                                                    │
│ Design and specify the Interactive Memory…                    │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ ↑↓  enter session  T timeline  / search  e edit  d del  q    │
└───────────────────────────────────────────────────────────────┘
```

## Key UX Patterns

- **Tab bar** at top — `[1 Context]` `2 Summaries` `3 Timeline` `4 All Memories` — active view bracketed
- **List pane** (left/top) — type badge + date + truncated title + ID or similarity score
- **Preview pane** (right/bottom) — full content, scrollable with shift+up/down
- **Help bar** (bottom) — contextual keyboard shortcuts per view
- **`▸`** = selected item, **`▶`** = anchor item (timeline view only)
- **Session drill-down** shows as breadcrumb: `2 Summaries ▸ [Session 9da3ab0e]` — not a separate tab
- **Type badges**: `obs` = observation, `sum` = summary, `prm` = prompt, `mem` = manual memory
