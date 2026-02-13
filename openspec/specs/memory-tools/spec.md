## ADDED Requirements

### Requirement: mem_search tool for LLM-initiated search
The system SHALL register a custom tool `mem_search` via `pi.registerTool()` that allows the LLM to search past session memories. The tool SHALL support both semantic (vector) and keyword (grep) search modes.

Parameters:
- `query` (string, required): The search query text
- `mode` (string, optional): `"semantic"` (default), `"keyword"`, or `"hybrid"` (both, merged)
- `project` (string, optional): Project slug to scope search. Defaults to current project.
- `limit` (number, optional): Maximum results to return. Default: 5.
- `cross_project` (boolean, optional): If true, search across all projects. Default: false.

Return format: A list of matching memories with metadata (project, date, session ID, relevance score) and content (full or excerpt depending on mode).

#### Scenario: Semantic search via mem_search
- **WHEN** the LLM calls `mem_search({ query: "authentication flow", mode: "semantic" })`
- **THEN** the tool performs a LanceDB vector search, returns the top 5 most semantically similar memories with their project, date, and full content

#### Scenario: Keyword search via mem_search
- **WHEN** the LLM calls `mem_search({ query: "refreshToken", mode: "keyword" })`
- **THEN** the tool runs `grep -ril` on memory files and returns matching files with surrounding context lines

#### Scenario: Hybrid search merges results
- **WHEN** the LLM calls `mem_search({ query: "auth bug", mode: "hybrid" })`
- **THEN** the tool runs both semantic and keyword search, deduplicates results by session ID, and returns a merged list ranked by relevance

#### Scenario: Cross-project search
- **WHEN** the LLM calls `mem_search({ query: "deployment pipeline", cross_project: true })`
- **THEN** the tool searches across all projects' memories and includes the project name in each result

#### Scenario: Search with no results
- **WHEN** the LLM calls `mem_search({ query: "xyznonexistent" })` and no memories match
- **THEN** the tool returns a message "No memories found matching 'xyznonexistent'" with suggestions (try broader terms, check other projects)

#### Scenario: LanceDB unavailable falls back to keyword
- **WHEN** the LLM calls `mem_search` with `mode: "semantic"` but LanceDB is unavailable
- **THEN** the tool automatically falls back to keyword search and includes a note that semantic search is unavailable

### Requirement: mem_save tool for manual memory storage
The system SHALL register a custom tool `mem_save` via `pi.registerTool()` that allows the LLM to explicitly save an important observation or decision as a memory, independent of the automatic session summary pipeline.

Parameters:
- `content` (string, required): The memory content to save
- `title` (string, optional): Short title for the memory. Auto-generated from content if omitted.
- `concepts` (array of strings, optional): Concept tags (e.g., `["decision", "architecture", "trade-off"]`)
- `project` (string, optional): Project slug. Defaults to current project.

#### Scenario: Manual memory saved
- **WHEN** the LLM calls `mem_save({ content: "Decided to use PostgreSQL instead of MongoDB for the user service because we need ACID transactions.", title: "Database choice: PostgreSQL", concepts: ["decision", "trade-off"] })`
- **THEN** the tool writes a memory file to `~/.pi-mem/projects/<project>/memories/` with the content, indexes it in LanceDB, and returns confirmation

#### Scenario: Manual memory with auto-generated title
- **WHEN** the LLM calls `mem_save({ content: "The CI pipeline requires Docker 24+ for the multi-platform build step." })`
- **THEN** the tool generates a title from the first sentence and saves the memory

#### Scenario: Manual memory indexed for search
- **WHEN** a manual memory is saved via `mem_save`
- **THEN** the memory is embedded and indexed in LanceDB (if available) and is findable by subsequent `mem_search` calls

### Requirement: mem_search follows progressive disclosure
The system SHALL implement progressive disclosure in `mem_search` results. Initial results show compact summaries (title, date, one-line description). The LLM can request full details by searching with specific session IDs.

#### Scenario: Initial search returns compact results
- **WHEN** the LLM calls `mem_search({ query: "auth" })` and 5 memories match
- **THEN** each result shows: date, project, title, and a one-line excerpt (~50-100 tokens per result)

#### Scenario: Detailed fetch by session ID
- **WHEN** the LLM calls `mem_search({ query: "session:abc123" })` with a specific session ID prefix
- **THEN** the tool returns the full memory content for that session (~500-1000 tokens)

### Requirement: Tool descriptions guide LLM usage
The system SHALL register `mem_search` and `mem_save` with clear, concise descriptions that guide the LLM on when and how to use them.

`mem_search` description SHALL indicate:
- Used to search past session memories for context
- Supports semantic, keyword, and hybrid modes
- Returns compact results by default (use session ID for full details)

`mem_save` description SHALL indicate:
- Used to explicitly save important decisions, discoveries, or context
- Complements automatic session summaries for high-value information

#### Scenario: LLM discovers tools from descriptions
- **WHEN** the LLM encounters a question about past work or project history
- **THEN** the tool descriptions are sufficient for the LLM to decide to use `mem_search` without explicit instruction

#### Scenario: LLM saves important decision proactively
- **WHEN** the LLM makes a significant architectural decision during a session
- **THEN** the `mem_save` description is clear enough for the LLM to proactively save it (especially if prompted by the system prompt addendum)
