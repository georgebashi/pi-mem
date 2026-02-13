## ADDED Requirements

### Requirement: search tool for keyword and filtered search
The system SHALL register a `search` tool that performs full-text search on the `text` column with optional filters. It SHALL return a compact index of results with IDs, suitable for progressive disclosure.

Parameters:
- `query` (string, required): Full-text search query
- `limit` (number, optional): Max results, default 20
- `offset` (number, optional): Skip first N results for pagination
- `project` (string, optional): Filter by project slug
- `type` (string, optional): Filter by observation type (bugfix, feature, decision, discovery, refactor, change)
- `obs_type` (string, optional): Filter by record type (observation, summary, prompt, manual)
- `dateStart` (string, optional): Filter by start date (YYYY-MM-DD)
- `dateEnd` (string, optional): Filter by end date (YYYY-MM-DD)
- `orderBy` (string, optional): Sort order (date_desc, date_asc, relevance)

Return format: Compact markdown table with columns `id`, `timestamp`, `type`, `tool_name`, `title` (~50-100 tokens per result).

The system SHALL use column projection via `.select()` to return only index columns — `id`, `session_id`, `project`, `type`, `timestamp`, `tool_name`, `title` — excluding `text`, `vector`, and other heavy columns.

#### Scenario: FTS search with results
- **WHEN** the LLM calls `search({ query: "compression agent" })`
- **THEN** the tool returns a compact table of matching rows with IDs, timestamps, types, and titles

#### Scenario: FTS search with type filter
- **WHEN** the LLM calls `search({ query: "auth", obs_type: "summary" })`
- **THEN** the tool returns only summary rows matching "auth"

#### Scenario: FTS search with date range
- **WHEN** the LLM calls `search({ query: "bug", dateStart: "2026-02-01", dateEnd: "2026-02-13" })`
- **THEN** the tool returns only rows within the date range matching "bug"

#### Scenario: FTS search with pagination
- **WHEN** the LLM calls `search({ query: "edit", limit: 10, offset: 20 })`
- **THEN** the tool returns results 21-30 from the full result set

#### Scenario: FTS search with no results
- **WHEN** the LLM calls `search({ query: "xyznonexistent" })`
- **THEN** the tool returns a message "No results found" with suggestions

### Requirement: timeline tool for chronological context
The system SHALL register a `timeline` tool that returns observations chronologically around an anchor point, providing temporal context.

Parameters:
- `anchor` (string, optional): Observation ID to center the timeline around
- `query` (string, optional): Search query to find the anchor automatically (used if anchor not provided)
- `depth_before` (number, optional): Number of observations before anchor, default 3
- `depth_after` (number, optional): Number of observations after anchor, default 3
- `project` (string, optional): Filter by project slug

At least one of `anchor` or `query` MUST be provided.

Return format: Chronological list showing id, timestamp, type, tool_name, title, and first 200 chars of text (~100-200 tokens per observation).

#### Scenario: Timeline around an anchor ID
- **WHEN** the LLM calls `timeline({ anchor: "a3f08c2b", depth_before: 3, depth_after: 3 })`
- **THEN** the tool returns 3 observations before and 3 after the anchor, ordered chronologically

#### Scenario: Timeline via query
- **WHEN** the LLM calls `timeline({ query: "fixed auth bug" })`
- **THEN** the tool finds the best matching observation, then returns surrounding context

#### Scenario: Timeline at session boundary
- **WHEN** the anchor is the first observation in a session
- **THEN** depth_before returns fewer results (as many as exist), depth_after returns the requested count

### Requirement: get_observations tool for full detail retrieval
The system SHALL register a `get_observations` tool that fetches complete observation details by ID. The tool SHALL support batch retrieval of multiple IDs in a single call.

Parameters:
- `ids` (array of strings, required): Observation IDs to fetch
- `orderBy` (string, optional): Sort order (date_desc, date_asc)
- `limit` (number, optional): Maximum observations to return
- `project` (string, optional): Filter by project slug

Return format: Complete observation data including all columns: id, session_id, project, type, timestamp, tool_name, title, text, concepts, files (~500-1000 tokens per observation).

#### Scenario: Batch fetch by IDs
- **WHEN** the LLM calls `get_observations({ ids: ["a3f08c2b", "b4e19d3c", "c5f20e4d"] })`
- **THEN** the tool returns full details for all three observations in a single response

#### Scenario: Single ID fetch
- **WHEN** the LLM calls `get_observations({ ids: ["a3f08c2b"] })`
- **THEN** the tool returns the complete observation record

#### Scenario: Nonexistent ID
- **WHEN** the LLM calls `get_observations({ ids: ["nonexistent"] })`
- **THEN** the tool returns a message indicating no observations found for the given IDs

### Requirement: save_memory tool for manual memory storage
The system SHALL register a `save_memory` tool that writes a `type = "manual"` row to the observations table with an embedding vector.

Parameters:
- `text` (string, required): Content to remember
- `title` (string, optional): Short title (auto-generated from text if omitted)
- `project` (string, optional): Project slug (defaults to current project)
- `concepts` (array of strings, optional): Concept tags

#### Scenario: Manual memory saved with embedding
- **WHEN** the LLM calls `save_memory({ text: "Decided to use PostgreSQL for ACID transactions.", title: "Database choice" })`
- **THEN** the tool writes a row with `type = "manual"`, computes an embedding vector, and returns confirmation

#### Scenario: Manual memory with auto-generated title
- **WHEN** the LLM calls `save_memory({ text: "CI pipeline requires Docker 24+ for multi-platform builds." })`
- **THEN** the tool generates a title from the text and saves the row

#### Scenario: Manual memory searchable via FTS and vector
- **WHEN** a manual memory has been saved
- **THEN** the memory is findable via `search` (FTS on text) and via semantic vector search in context injection

### Requirement: Progressive disclosure workflow guidance
The system SHALL inject 3-layer workflow guidance into the session context via `before_agent_start`, instructing the agent to follow the pattern: search → timeline → get_observations.

The guidance text SHALL be:
```
3-LAYER WORKFLOW (ALWAYS FOLLOW):
1. search(query) → Get index with IDs (~50-100 tokens/result)
2. timeline(anchor=ID) → Get context around interesting results
3. get_observations([IDs]) → Fetch full details ONLY for filtered IDs
NEVER fetch full details without filtering first. 10x token savings.
```

#### Scenario: Workflow guidance included in context
- **WHEN** `before_agent_start` fires and pi-mem is enabled
- **THEN** the injected context includes the 3-layer workflow guidance text

#### Scenario: Guidance not duplicated as a tool
- **WHEN** tools are registered
- **THEN** there is no `__IMPORTANT` tool — the guidance is only in the injected context

### Requirement: Tool descriptions guide efficient usage
Each search tool SHALL have a concise description that indicates its role in the 3-layer pattern.

- `search`: "Step 1: Search memory. Returns compact index with IDs."
- `timeline`: "Step 2: Get chronological context around a result."
- `get_observations`: "Step 3: Fetch full details for specific IDs. Always batch multiple IDs."
- `save_memory`: "Save important information to memory for future sessions."

#### Scenario: Tool descriptions reflect layer number
- **WHEN** the LLM lists available tools
- **THEN** search, timeline, and get_observations descriptions indicate their step number in the workflow
