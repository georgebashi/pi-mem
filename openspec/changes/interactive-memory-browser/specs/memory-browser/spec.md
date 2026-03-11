## ADDED Requirements

### Requirement: Register /mem-browse command
The system SHALL register a `/mem-browse` command via `pi.registerCommand()` that launches an interactive full-screen memory browser using `ctx.ui.custom()`.

#### Scenario: Command launches browser
- **WHEN** the user types `/mem-browse`
- **THEN** the system displays a full-screen interactive memory browser that takes over the TUI

#### Scenario: Command requires enabled store
- **WHEN** the user types `/mem-browse` and pi-mem is disabled or the store is unavailable
- **THEN** the system shows a notification "pi-mem is not available" and does not launch the browser

### Requirement: Injected context view as the home screen
The browser SHALL open to an "Injected Context" view showing exactly what the agent would see at `before_agent_start`. This view SHALL display: the project memory index (recent summaries list) and the workflow guidance text. The user SHALL be able to type a test prompt to see what semantic search results would be included in the injected context.

#### Scenario: Home screen shows project memory index
- **WHEN** the browser opens
- **THEN** the home screen displays the project memory index (recent summaries with dates and session IDs) and the workflow guidance, matching the format produced by `buildInjectedContext()`

#### Scenario: Test prompt shows semantic search results
- **WHEN** the user types a test prompt in the injected context view (e.g., "authentication flow")
- **THEN** the view updates to also show the semantic search results that would be injected for that prompt, below the memory index

#### Scenario: No embeddings shows partial view
- **WHEN** embeddings are not configured
- **THEN** the injected context view shows the memory index and a note that semantic search is unavailable

### Requirement: Layered navigation between views
The browser SHALL support four top-level views accessible via number keys:
1. **Injected Context** (home) — what the agent sees
2. **Summaries** — all session summaries for the project
3. **Timeline** — chronological context around a selected memory (mirrors the agent's `timeline()` tool)
4. **All Memories** — flat list of all rows with type/search filtering

Additionally, a **Session** drill-down view SHALL be accessible by pressing enter on a summary, showing that session's observations.

The current view SHALL be indicated in a tab bar or header. Pressing the corresponding number key (1-4) SHALL switch top-level views.

#### Scenario: Switch views with number keys
- **WHEN** the user presses `2` while in the injected context view
- **THEN** the browser switches to the summaries view

#### Scenario: Drill down from summary to session observations
- **WHEN** the user presses enter on a summary in the summaries view
- **THEN** the browser switches to the session view showing that session's observations chronologically

#### Scenario: Open timeline from any list view
- **WHEN** the user presses `T` on any selected item in any list view
- **THEN** the browser switches to the timeline view anchored on that item

#### Scenario: Tab bar shows current view
- **WHEN** the browser is in the summaries view
- **THEN** the tab bar highlights "Summaries" as the active view

### Requirement: Session view showing a summary's source observations
The session view SHALL display all observations for a given session, ordered chronologically. This view is reached by pressing enter on a summary in the summaries view, and shows the raw tool executions that were compressed into that summary — the "source data" behind the memory.

The session view SHALL use the same two-pane layout as other list views. Pressing escape or backspace SHALL return to the summaries view.

#### Scenario: Session shows observations chronologically
- **WHEN** the user drills into a session from a summary
- **THEN** the session view displays all observations for that session_id ordered by timestamp ascending

#### Scenario: Session view has back navigation
- **WHEN** the user presses escape or backspace in the session view
- **THEN** the browser returns to the summaries view with the previous selection preserved

#### Scenario: Empty session
- **WHEN** the user drills into a session that has no observations (e.g., observations were deleted)
- **THEN** the session view shows "No observations for this session"

### Requirement: Timeline view showing chronological context
The timeline view SHALL display the chronological neighbourhood around a selected anchor memory, mirroring the agent's `timeline(anchor=ID)` tool. It SHALL show observations before and after the anchor, with the anchor visually highlighted. The default depth SHALL be 5 items before and 5 items after. The user SHALL be able to adjust depth with `+` and `-` keys.

The timeline view SHALL be accessible by pressing `T` (shift+t) on any selected item in any list view (summaries, session, all memories, or the timeline itself).

#### Scenario: Open timeline from any list view
- **WHEN** the user presses `T` on a selected memory in the all memories view
- **THEN** the browser switches to the timeline view anchored on that memory

#### Scenario: Timeline shows chronological neighbourhood
- **WHEN** the timeline view opens with an anchor
- **THEN** it displays observations before the anchor, the anchor (highlighted), and observations after the anchor, in chronological order

#### Scenario: Anchor is visually highlighted
- **WHEN** the timeline view is displayed
- **THEN** the anchor item is visually distinct from surrounding items (e.g., different background colour or border)

#### Scenario: Adjust timeline depth
- **WHEN** the user presses `+` in the timeline view
- **THEN** the depth increases (more items before and after) and the timeline reloads

#### Scenario: Decrease timeline depth
- **WHEN** the user presses `-` in the timeline view
- **THEN** the depth decreases (fewer items before and after) and the timeline reloads

#### Scenario: Timeline at edge of data
- **WHEN** the anchor is one of the earliest observations
- **THEN** fewer items are shown before the anchor (as many as exist), while the requested depth is shown after

#### Scenario: Navigate within timeline
- **WHEN** the user selects a different item in the timeline and presses `T`
- **THEN** the timeline re-anchors on the newly selected item

### Requirement: Two-pane layout with list and preview
Each list-based view (summaries, timeline, all memories) SHALL display a two-pane layout: a scrollable list on the left and a preview pane showing the full content of the selected item on the right. On terminals narrower than 100 columns, the layout SHALL switch to stacked mode (list on top, preview on bottom).

#### Scenario: Wide terminal shows side-by-side panes
- **WHEN** the terminal width is 100 columns or more
- **THEN** the list pane occupies approximately 40% of the width and the preview pane occupies approximately 60%

#### Scenario: Narrow terminal shows stacked panes
- **WHEN** the terminal width is less than 100 columns
- **THEN** the list pane occupies the top half and the preview pane occupies the bottom half

### Requirement: Scrollable memory list with compact display
List panes SHALL display items in a scrollable list with each entry showing: type badge, timestamp (date only), and title (truncated to fit). The currently selected entry SHALL be visually highlighted. The list SHALL support keyboard navigation with up/down arrows and page up/page down.

#### Scenario: Navigate list with arrow keys
- **WHEN** the user presses the down arrow key
- **THEN** the selection moves to the next item in the list and the preview updates

#### Scenario: Page through large lists
- **WHEN** the user presses page down
- **THEN** the list scrolls by one page of visible items

#### Scenario: Type badges distinguish memory types
- **WHEN** the list displays memories of different types
- **THEN** observations show "obs", summaries show "sum", prompts show "prm", and manual saves show "mem"

### Requirement: Preview pane shows full content
The preview pane SHALL display the full content of the currently selected item, including: title, type, timestamp, session ID, project, concepts, files read, files modified, and the full narrative/text content. The preview SHALL be scrollable if content exceeds the pane height.

#### Scenario: Preview updates on selection change
- **WHEN** the user navigates to a different item in the list
- **THEN** the preview pane immediately updates to show the newly selected item's full content

#### Scenario: Long content is scrollable
- **WHEN** the selected item's content exceeds the preview pane height
- **THEN** the user can scroll the preview with shift+up/shift+down

### Requirement: FTS keyword search
The browser SHALL support FTS keyword search. When the user presses `/` (slash), a search input SHALL appear. Typing filters the current view's list using FTS search on the narrative column. Pressing escape clears the search. Pressing enter confirms the search and returns focus to the list.

#### Scenario: Activate search with slash
- **WHEN** the user presses `/`
- **THEN** a search input appears with cursor focus

#### Scenario: Search filters list
- **WHEN** the user types "authentication" in the search input and presses enter
- **THEN** the list updates to show only memories matching "authentication" via FTS

#### Scenario: Clear search with escape
- **WHEN** the user presses escape while the search input is active
- **THEN** the search input is cleared, the full unfiltered list is restored, and focus returns to the list

### Requirement: Semantic vector search
The browser SHALL support semantic vector search. When the user presses `v`, a search input SHALL appear for entering a semantic query. On submit, the browser performs a vector search using the same embedding function as context injection and displays results ranked by vector similarity. This is only available when embeddings are configured.

#### Scenario: Vector search with results
- **WHEN** the user presses `v`, types "how does authentication work", and presses enter
- **THEN** the list shows memories ranked by semantic similarity to the query

#### Scenario: Vector search without embeddings
- **WHEN** the user presses `v` and embeddings are not configured
- **THEN** the browser shows a notification "Embeddings not configured — vector search unavailable"

#### Scenario: Vector search results show similarity
- **WHEN** vector search results are displayed
- **THEN** each result shows its similarity ranking or distance score

### Requirement: Filter by type in all memories view
In the all memories view, pressing `t` SHALL cycle through type filters: all → observation → summary → prompt → manual → all. The active filter SHALL be displayed in the header.

#### Scenario: Cycle type filter
- **WHEN** the user presses `t` while in the all memories view
- **THEN** the type filter advances to the next type and the list is re-filtered

#### Scenario: Type filter displayed in header
- **WHEN** a type filter is active
- **THEN** the header shows the active type (e.g., "Filter: summary")

### Requirement: Delete selected memory
The browser SHALL support deleting the currently selected memory by pressing `d`. A confirmation dialog SHALL appear before deletion. After deletion, the list refreshes and the selection moves to the next item.

#### Scenario: Delete with confirmation
- **WHEN** the user presses `d` on a selected memory
- **THEN** a confirmation dialog appears asking "Delete this memory?"
- **AND WHEN** the user confirms
- **THEN** the memory is deleted from the store and the list refreshes

#### Scenario: Cancel delete
- **WHEN** the user presses `d` and then cancels the confirmation
- **THEN** nothing is deleted and the browser returns to its previous state

### Requirement: Edit selected memory with re-embedding
The browser SHALL support editing the currently selected memory by pressing `e`. An editor SHALL appear showing the editable fields: title and narrative/text. After saving, the memory is updated in the store. If the narrative changed and the row type is summary or manual (types with embeddings), the embedding vector SHALL be recomputed. The preview refreshes to show the updated content.

#### Scenario: Edit title and narrative
- **WHEN** the user presses `e` on a selected memory
- **THEN** an editor interface appears with the current title and narrative pre-filled
- **AND WHEN** the user modifies the text and confirms
- **THEN** the memory is updated in the store and the preview pane shows the updated content

#### Scenario: Edit triggers re-embedding for summary
- **WHEN** the user edits the narrative of a summary-type memory and saves
- **THEN** the system recomputes the embedding vector for the updated narrative

#### Scenario: Edit without embedding provider
- **WHEN** the user edits a summary's narrative but no embedding provider is configured
- **THEN** the narrative is updated but the vector remains unchanged (zero vector)

#### Scenario: Cancel edit
- **WHEN** the user presses `e` and then presses escape
- **THEN** no changes are saved and the browser returns to its previous state

### Requirement: Exit browser
The browser SHALL close when the user presses `q` or escape (when not in search/edit mode), returning to the normal pi TUI.

#### Scenario: Exit with q
- **WHEN** the user presses `q`
- **THEN** the browser closes and the normal pi interface is restored

#### Scenario: Exit with escape from list
- **WHEN** the user presses escape and no search input or editor is active
- **THEN** the browser closes and the normal pi interface is restored

### Requirement: Help bar showing keyboard shortcuts
The browser SHALL display a help bar at the bottom showing available keyboard shortcuts contextual to the current view. The base shortcuts are: `↑↓ navigate`, `1-4 views`, `/ search`, `v vector`, `T timeline`, `e edit`, `d delete`, `q quit`.

#### Scenario: Help bar visible
- **WHEN** the browser is displayed
- **THEN** a help bar at the bottom shows the available keyboard shortcuts

#### Scenario: Help bar is contextual
- **WHEN** the user is in the timeline view
- **THEN** the help bar includes timeline-specific shortcuts (`+/- depth`, `T re-anchor`)

### Requirement: Load memories with pagination
List views SHALL initially load the most recent 100 items. When the user scrolls near the bottom, additional items SHALL be loaded automatically. The total count SHALL be displayed in the header.

#### Scenario: Initial load
- **WHEN** a list view opens
- **THEN** the most recent 100 items for the current project are loaded and displayed

#### Scenario: Load more on scroll
- **WHEN** the user scrolls within 10 items of the bottom and more items exist
- **THEN** the next batch of 100 items is loaded and appended to the list
