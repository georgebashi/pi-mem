## ADDED Requirements

### Requirement: Unified LanceDB observations table
The system SHALL store all data in a single LanceDB table named `observations` at `~/.pi-mem/lancedb/`. Each row SHALL contain:
- `id` (string): Short UUID identifier (e.g., "a3f08c2b")
- `session_id` (string): Session UUID grouping observations within a prompt cycle
- `project` (string): Project slug
- `type` (string): One of "observation", "prompt", "summary", "manual"
- `timestamp` (string): ISO 8601 timestamp
- `tool_name` (string): Tool name for observations (e.g., "bash", "read"); empty string for other types
- `title` (string): Short descriptive title
- `text` (string): Full searchable text content (FTS indexed)
- `concepts` (string): Comma-separated concept tags
- `files` (string): Comma-separated file paths
- `vector` (float[1536], nullable): Embedding vector, populated only for summary and manual rows

#### Scenario: Table created on first write
- **WHEN** the first observation is captured and no `observations` table exists
- **THEN** the system creates the table with the row as the initial data, establishing the schema

#### Scenario: Table opened on subsequent sessions
- **WHEN** the extension starts and the `observations` table already exists
- **THEN** the system opens the existing table without recreating it

#### Scenario: Observation row written without vector
- **WHEN** a `type = "observation"` row is inserted
- **THEN** the `vector` column is `null` (no embedding computed)

#### Scenario: Summary row written with vector
- **WHEN** a `type = "summary"` row is inserted
- **THEN** the `vector` column contains a float[1536] embedding of the text content

### Requirement: FTS index on text column
The system SHALL create a full-text search index on the `text` column of the `observations` table to support keyword search queries.

#### Scenario: FTS index created after table creation
- **WHEN** the `observations` table is created for the first time
- **THEN** the system creates an FTS index on the `text` column

#### Scenario: FTS index rebuilt at session end
- **WHEN** `agent_end` fires and new rows have been added during the session
- **THEN** the system recreates the FTS index to include the new rows

#### Scenario: FTS search returns matching rows
- **WHEN** a search query "compression agent" is executed via FTS
- **THEN** the system returns rows whose `text` column contains those terms, scored by relevance

### Requirement: Scalar indexes on filter columns
The system SHALL create scalar indexes on `project`, `session_id`, and `timestamp` columns to optimize filter queries. The system SHALL create a bitmap index on the `type` column.

#### Scenario: Indexes created after table creation
- **WHEN** the `observations` table is created for the first time
- **THEN** the system creates B-Tree indexes on `project`, `session_id`, `timestamp` and a Bitmap index on `type`

#### Scenario: Filtered queries use indexes
- **WHEN** a query includes `.where("project = 'pi-mem' AND type = 'observation'")`
- **THEN** the query uses the scalar indexes for efficient filtering

### Requirement: Table compaction at session end
The system SHALL compact the `observations` table at `agent_end` to reduce fragmentation from per-observation appends during the session.

#### Scenario: Compaction runs after summary write
- **WHEN** `agent_end` fires and the session summary has been written
- **THEN** the system calls table compaction to merge small fragments

#### Scenario: Compaction failure is non-fatal
- **WHEN** compaction fails (e.g., concurrent access)
- **THEN** the system logs a warning and continues without interruption
