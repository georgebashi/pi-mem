## MODIFIED Requirements

### Requirement: Capture tool results as observations
The system SHALL listen to `tool_result` events from pi's extension API and write each tool execution as a row in the LanceDB `observations` table immediately (not buffered).

Each observation row SHALL include:
- `id`: Short UUID (8 chars)
- `session_id`: Current session UUID
- `project`: Current project slug
- `type`: "observation"
- `timestamp`: ISO 8601
- `tool_name`: Tool name (e.g., `bash`, `read`, `edit`, `write`)
- `title`: Tool name + brief input summary (e.g., "bash: ls -la", "read: config.ts")
- `text`: Truncated tool output (configurable max length)
- `concepts`: empty string
- `files`: Comma-separated file paths extracted from tool input
- `vector`: null (no embedding for observations)

#### Scenario: Standard tool execution written to LanceDB
- **WHEN** the LLM calls a tool (e.g., `bash` with `{ command: "ls" }`) and the tool returns a result
- **THEN** the extension writes a row to the `observations` table with type "observation", the tool name, input summary, and truncated output

#### Scenario: Tool output exceeds max length
- **WHEN** a tool result exceeds the configured maximum output length (default: 4000 characters)
- **THEN** the extension truncates the output and appends `... (truncated, {original_length} chars)`

#### Scenario: Multiple tools in one turn
- **WHEN** the LLM calls multiple tools in a single turn
- **THEN** each tool result is written as a separate row with incrementing timestamps

#### Scenario: Write failure is non-fatal
- **WHEN** a LanceDB write fails for any reason
- **THEN** the system logs a warning and continues without interruption

### Requirement: Privacy filtering on observations
The system SHALL strip content enclosed in `<private>...</private>` tags from tool outputs before writing to LanceDB. The system SHALL also skip observation capture for file paths matching patterns in `.pi-mem-ignore`.

#### Scenario: Private tags stripped from output
- **WHEN** a tool result contains `<private>secret-api-key-123</private>`
- **THEN** the stored row replaces the tagged content with `[REDACTED]`

#### Scenario: File path excluded by ignore patterns
- **WHEN** a `read` tool result is for a file matching a pattern in `.pi-mem-ignore` (e.g., `*.env`)
- **THEN** no row is written to the observations table

#### Scenario: No .pi-mem-ignore file exists
- **WHEN** no `.pi-mem-ignore` file exists
- **THEN** the system captures all observations without path filtering

## REMOVED Requirements

### Requirement: Buffer observations in memory during session
**Reason**: Observations are now written directly to LanceDB per tool call. The in-memory buffer is no longer needed since LanceDB serves as the durable store. At `agent_end`, observations are queried from LanceDB instead of read from the buffer.
**Migration**: Remove `ObservationBuffer` class. Replace `observationBuffer.getAll()` at `agent_end` with a LanceDB query: `table.query().where("session_id = '...' AND type = 'observation'").toArray()`.

### Requirement: Persist raw observations to session file
**Reason**: Raw session markdown files are eliminated. LanceDB is the sole store. Observations are written directly to LanceDB rows instead of appended to a session markdown file.
**Migration**: Remove `session-writer.ts`. Users who want raw session data can use `get_observations` tool or ask the agent to export.
