## Context

pi-mem stores all memories (observations, prompts, summaries, manual saves) in a single LanceDB `observations_v2` table at `~/.pi-mem/lancedb/`. The context injection system (`context-injection.ts`) builds what the agent sees at `before_agent_start`: a project memory index (recent summaries list), prompt-aware semantic search results (top-2 most relevant summaries), and workflow guidance. This injected context is the agent's "view" of memory.

The agent navigates memory via a 3-layer progressive disclosure workflow: **search** (get compact index) → **timeline** (get chronological context around an anchor) → **get_observations** (fetch full details). The timeline tool is central — it shows what happened before and after a given point, giving the agent temporal context.

The data model is layered: raw tool outputs become structured **observations** (via the observer agent), observations are compressed into **session summaries** at `agent_end`, **prompts** capture user input, and **manual saves** are explicit user memories. Summaries and manual saves have embedding vectors for semantic search; observations and prompts do not.

Users currently interact with memories only indirectly through LLM tools or the status-only `/mem` command. There is no way to see what the agent sees, test whether semantic search returns good results, browse the timeline, or curate bad memories.

## Goals / Non-Goals

**Goals:**
- Let users see exactly what the agent sees — the injected context — as the entry point
- Let users drill down through the layered data model: injected context → summaries → session observations → prompts
- Let users browse the timeline around any memory, mirroring the agent's `timeline()` tool
- Support both FTS keyword search and semantic vector search so users can test search quality and verify results
- Edit memory title, narrative, and concepts — with re-embedding when narrative changes
- Delete individual memories with confirmation
- Expose update/delete/re-embed as exported functions from `observation-store.ts`

**Non-Goals:**
- No creating new memories from the browser (use `save_memory` tool)
- No editing of system-generated fields like `files_read`, `files_modified`, `facts` (those are ground truth from tool execution)
- No bulk operations in v1 (keep the UX simple; can add later)
- No cross-project browsing (scoped to current project)

## Decisions

### Decision 1: Agent-brain-first UX with layered navigation
The browser opens showing "What the agent sees" — the injected context that would be produced by `buildInjectedContext()` for the current project. This is the most important view because it shows the user the actual input to the LLM. From there, the user can drill into layers:

- **Injected Context view** (home): Shows the project memory index + semantic search results, rendered as the agent would see them
- **Summaries view**: All session summaries for the project, browseable with preview. Pressing enter on a summary drills into that session's observations.
- **Session view**: The observations that were compressed into a specific summary — the raw material. Shown chronologically for the session. Reached by pressing enter on a summary.
- **Timeline view**: Chronological context around any selected memory — exactly what the agent sees from `timeline(anchor=ID)`. Reachable by pressing `T` on any selected item in any list view. Shows cross-session temporal context.
- **All memories view**: Flat list of all rows (observations, prompts, summaries, manual) with filtering

Navigation between the main views uses number keys (1-4) for: Injected Context, Summaries, Timeline, All Memories. Session view is a drill-down from Summaries (enter), not a top-level tab.

**Alternative considered:** Flat list of all memories as the entry point. Rejected because it doesn't help users understand what the agent actually sees — which is the core value proposition.

### Decision 2: Session drill-down from summaries
Summaries are compressions of a session's observations. The natural drill-down from a summary is to see the observations that built it. Pressing enter on a summary in the Summaries view opens the Session view, which queries all observations for that `session_id` ordered by timestamp. This shows the user the raw tool executions that were compressed into the summary — the "source data" behind each memory.

The Session view has a back action (escape or backspace) that returns to the Summaries view.

### Decision 3: Timeline as a cross-session contextual view
The timeline view is a separate concern from session drill-down. It shows cross-session chronological context around any selected item — what happened before and after this point in time across the whole project, exactly like the agent's `timeline(anchor=ID)` tool. Accessible by pressing `T` (shift+t) on any selected item in any list view. The depth (items before/after) defaults to 5 and is adjustable with `+`/`-`. The anchor item is visually highlighted.

This lets users see temporal context: "what was the agent doing around the time this memory was created?" — a key part of the 3-layer workflow.

### Decision 4: Dual search modes — FTS and vector
The browser supports two search modes:
- **FTS search** (`/`): Keyword search on the narrative column, same as the `search` tool
- **Vector search** (`v`): Semantic search using the same embedding function as context injection. Shows results ranked by vector distance. Only available when embeddings are configured.

Vector search is critical because it lets users test "if I ask about X, what would the agent find?" — directly verifying semantic search quality.

### Decision 5: Re-embedding on edit
When a user edits the narrative of a summary or manual memory (the types that have embedding vectors), the system recomputes the embedding vector using the same `store.embed()` function. This ensures edited content remains findable via semantic search. If the embedding provider is unavailable, the edit still saves but with a zero vector (same graceful degradation as initial save).

**Alternative considered:** Not re-embedding (stale vectors). Rejected per user feedback — editing a memory to fix it should also fix its searchability.

### Decision 6: Use `ctx.ui.custom()` for the full-screen browser
The browser is a custom TUI component via `ctx.ui.custom()`. Full-screen ownership with keyboard control. Two-pane layout: navigation/list on the left, content/preview on the right. On narrow terminals (< 100 cols), stacked layout.

### Decision 7: Register as `/mem-browse` command
New command separate from the existing `/mem` status command. The browser is a full interactive experience; `/mem` remains a quick status check.

### Decision 8: LanceDB mutation strategy
- **Delete**: `table.delete("id = '...'")` followed by `compactAndReindex()`
- **Update**: `table.update({ where: "id = '...'", values: { ... } })` for field changes. If narrative changed and row type is summary/manual, also recompute and update the vector column.

## Risks / Trade-offs

- **[LanceDB update limitations]** → LanceDB's `update()` may have quirks with certain column types. Mitigation: test with actual schema; fall back to delete+re-insert if needed.
- **[Embedding latency on edit]** → Re-embedding requires an API call which adds latency to the edit flow. Mitigation: show a "Saving..." indicator; the call is typically <500ms for small text.
- **[Performance on large stores]** → Loading all memories could be slow with thousands of rows. Mitigation: paginate with limit/offset; default to most recent 100; load more on demand.
- **[Vector search without embeddings]** → If no embedding provider is configured, vector search is unavailable. Mitigation: show "Embeddings not configured" message; FTS still works.
- **[Injected context depends on prompt]** → The semantic search portion of injected context is prompt-dependent. The browser can show a "test prompt" input or use a default view without the prompt-specific part. Mitigation: show the static portion (recent summaries index) by default, let user type a test prompt to see what semantic results would be injected.
