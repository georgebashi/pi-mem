## ADDED Requirements

### Requirement: Index memory files into LanceDB
The system SHALL index each compressed memory file into a LanceDB table after it is written. Each row in the table SHALL contain:
- `text`: full memory content (markdown text)
- `project`: project slug
- `session_id`: session identifier
- `date`: ISO date string
- `concepts`: comma-separated concept tags
- `files_read`: comma-separated list of files read
- `files_modified`: comma-separated list of files modified
- `vector`: embedding vector of the text content

#### Scenario: Memory indexed after creation
- **WHEN** a new memory file is written to `memories/`
- **THEN** the system generates an embedding for the text content and upserts a row into the LanceDB `memories` table

#### Scenario: LanceDB database created on first index
- **WHEN** the first memory is indexed and no LanceDB database exists at `~/.pi-mem/lancedb/`
- **THEN** the system creates the database and `memories` table with the appropriate schema

#### Scenario: Re-indexing an existing session
- **WHEN** a memory file is regenerated for an existing session ID
- **THEN** the system updates (upserts) the existing row in LanceDB rather than creating a duplicate

### Requirement: Semantic vector search
The system SHALL support semantic similarity search across all indexed memories via LanceDB's vector search capability. Queries return the top-K most similar memories ranked by vector distance.

#### Scenario: Semantic search returns relevant results
- **WHEN** a search query "how does authentication work" is executed
- **THEN** the system embeds the query, performs a vector similarity search on the LanceDB table, and returns the top-K results (default K=5) with their project, date, and content

#### Scenario: Search scoped to project
- **WHEN** a search query includes a project filter (e.g., project="github.com-acme-widget")
- **THEN** results are filtered to only memories from that project before ranking

#### Scenario: Cross-project search
- **WHEN** a search query does not specify a project filter
- **THEN** results include memories from all projects, ranked by relevance

### Requirement: Keyword search via grep fallback
The system SHALL support keyword search by running `grep -ril` on the markdown memory files in `~/.pi-mem/projects/`. This provides exact string matching as a complement to semantic search.

#### Scenario: Keyword search finds exact match
- **WHEN** a keyword search for "refreshToken" is executed
- **THEN** the system runs grep on memory files and returns matching file paths with surrounding context

#### Scenario: Keyword search scoped to project
- **WHEN** a keyword search includes a project filter
- **THEN** grep runs only on files under `~/.pi-mem/projects/<project>/memories/`

#### Scenario: Keyword search with no results
- **WHEN** a keyword search for "xyznonexistent" is executed
- **THEN** the system returns an empty result set with a message "No memories found matching 'xyznonexistent'"

### Requirement: Graceful degradation without LanceDB
The system SHALL function without LanceDB if it fails to initialize (e.g., native module not available). In this mode, only keyword (grep) search is available.

#### Scenario: LanceDB unavailable at startup
- **WHEN** the extension starts and LanceDB fails to initialize
- **THEN** the system logs a warning, disables vector search, and continues with grep-only search. Observation capture, summarization, and context injection still work.

#### Scenario: Search falls back to grep when LanceDB is down
- **WHEN** a `mem_search` tool call is made and LanceDB is unavailable
- **THEN** the system automatically falls back to keyword search using grep and notes the fallback in the result

### Requirement: Configurable embedding model
The system SHALL support configurable embedding models for vector search. The default SHALL use LanceDB's built-in embedding functions. Users MAY override via `config.json`.

#### Scenario: Default embedding model used
- **WHEN** no `embeddingModel` is configured in `config.json`
- **THEN** the system uses LanceDB's default embedding function

#### Scenario: Custom embedding model configured
- **WHEN** `config.json` specifies `"embeddingModel": "openai/text-embedding-3-small"`
- **THEN** the system uses the specified model for all embedding operations
