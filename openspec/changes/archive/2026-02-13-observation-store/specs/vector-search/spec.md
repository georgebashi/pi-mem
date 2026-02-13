## MODIFIED Requirements

### Requirement: Semantic vector search on summaries and manual saves
The system SHALL support semantic similarity search via LanceDB's `vectorSearch()` on rows that have non-null `vector` columns (i.e., `type = "summary"` and `type = "manual"` rows). Queries return the top-K most similar rows ranked by vector distance.

The system SHALL apply pre-filtering (`.where()`) before vector search to scope results by project or other metadata columns.

#### Scenario: Semantic search returns relevant summaries
- **WHEN** a vector search query is executed with an embedded prompt
- **THEN** the system runs `vectorSearch(queryVector).where("project = '...'").limit(K)` and returns matching summary/manual rows

#### Scenario: Search scoped to project
- **WHEN** a vector search includes a project filter
- **THEN** results are pre-filtered to only rows from that project before ranking

#### Scenario: Observation rows excluded from vector search
- **WHEN** a vector search is executed
- **THEN** rows with `vector: null` (observations and prompts) are automatically excluded by LanceDB

### Requirement: Embedding via pi provider system
The system SHALL compute embeddings by calling an OpenAI-compatible `/v1/embeddings` endpoint, resolved via pi's `modelRegistry` for the configured `embeddingProvider`. The embedding model defaults to `text-embedding-3-small` (1536 dimensions).

#### Scenario: Embedding computed for summary
- **WHEN** a session summary is generated at `agent_end`
- **THEN** the system computes an embedding of the summary text and stores it in the `vector` column

#### Scenario: Embedding computed for manual save
- **WHEN** a `save_memory` tool call is executed
- **THEN** the system computes an embedding of the text and stores it in the `vector` column

#### Scenario: Embedding provider not configured
- **WHEN** no `embeddingProvider` is set in config
- **THEN** the system writes rows with `vector: null`. FTS search still works. Semantic search is unavailable.

### Requirement: Graceful degradation without embeddings
The system SHALL function without embeddings if the provider is not configured or fails. FTS search, filter queries, and timeline navigation SHALL work regardless of embedding availability.

#### Scenario: No embedding provider configured
- **WHEN** the extension starts with no `embeddingProvider` in config
- **THEN** the system logs a note, disables vector search, and continues with FTS-only search. All observation capture and summarization still work.

#### Scenario: Embedding API failure
- **WHEN** an embedding computation fails (API error, timeout)
- **THEN** the system writes the row with `vector: null` and logs a warning. The row is still searchable via FTS.

## REMOVED Requirements

### Requirement: Keyword search via grep fallback
**Reason**: FTS on the LanceDB `text` column replaces grep-based keyword search. LanceDB FTS provides equivalent functionality (tokenized keyword matching) without requiring filesystem operations on markdown files.
**Migration**: Remove `keyword-search.ts`. All keyword search goes through LanceDB FTS.

### Requirement: Configurable embedding model
**Reason**: Replaced by the `embeddingProvider` + `embeddingModel` config fields, which route through pi's provider system instead of LanceDB's built-in embedding functions.
**Migration**: Already done — `embeddingProvider` and `embeddingModel` are in the current config. No further changes needed.

### Requirement: Index memory files into LanceDB
**Reason**: The old `memories` table (one row per session summary markdown file) is replaced by the unified `observations` table. Summaries are now written directly as rows, not indexed from markdown files.
**Migration**: Remove the `indexMemory` function. Summary rows are inserted directly at `agent_end`.
