## ADDED Requirements

### Requirement: Capture tool results as observations
The system SHALL listen to `tool_result` events from pi's extension API and record each tool execution as a raw observation in the current session's observation buffer.

Each observation SHALL include:
- Timestamp (ISO 8601)
- Tool name (e.g., `bash`, `read`, `edit`, `write`)
- Tool input parameters (JSON)
- Tool output content (text, truncated to a configurable max length)
- Working directory (`ctx.cwd`)

#### Scenario: Standard tool execution captured
- **WHEN** the LLM calls a tool (e.g., `bash` with `{ command: "ls" }`) and the tool returns a result
- **THEN** the extension records an observation with the tool name, input, output, timestamp, and cwd in the in-memory buffer

#### Scenario: Tool output exceeds max length
- **WHEN** a tool result exceeds the configured maximum output length (default: 4000 characters)
- **THEN** the extension truncates the output and appends `... (truncated, {original_length} chars)` to the stored observation

#### Scenario: Multiple tools in one turn
- **WHEN** the LLM calls multiple tools in a single turn (e.g., `read`, then `edit`, then `bash`)
- **THEN** each tool result is captured as a separate observation in chronological order

### Requirement: Buffer observations in memory during session
The system SHALL maintain an in-memory buffer of observations for the current prompt cycle. The buffer is accumulated during `tool_result` events and consumed at `agent_end` for summarization.

#### Scenario: Buffer accumulates across turns
- **WHEN** the agent executes across multiple turns within a single user prompt
- **THEN** the observation buffer contains all tool results from all turns since the last `agent_end`

#### Scenario: Buffer resets after agent_end
- **WHEN** the `agent_end` event fires and observations have been processed
- **THEN** the in-memory observation buffer is cleared for the next prompt cycle

### Requirement: Persist raw observations to session file
The system SHALL append each observation to the current session's raw session file in `~/.pi-mem/projects/<project>/sessions/` as it is captured.

#### Scenario: Observation appended to session file
- **WHEN** a tool result is captured
- **THEN** the observation is appended to the session markdown file in the format: `### [HH:MM:SS] <tool_name>` followed by input and output

#### Scenario: Session file created on first observation
- **WHEN** the first observation of a session is captured and no session file exists
- **THEN** the system creates a new session file with the header (session timestamp, project, prompt) and writes the observation

### Requirement: Privacy filtering on observations
The system SHALL strip content enclosed in `<private>...</private>` tags from tool outputs before storing observations. The system SHALL also skip observation capture for file paths matching patterns in `.pi-mem-ignore`.

#### Scenario: Private tags stripped from output
- **WHEN** a tool result contains `<private>secret-api-key-123</private>`
- **THEN** the stored observation replaces the tagged content with `[REDACTED]`

#### Scenario: File path excluded by ignore patterns
- **WHEN** a `read` tool result is for a file matching a pattern in `.pi-mem-ignore` (e.g., `*.env`)
- **THEN** the observation is NOT captured at all (silently skipped)

#### Scenario: No .pi-mem-ignore file exists
- **WHEN** no `.pi-mem-ignore` file exists in the project root or `~/.pi-mem/`
- **THEN** the system captures all observations without path filtering
