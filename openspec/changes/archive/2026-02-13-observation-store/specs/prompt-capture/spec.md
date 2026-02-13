## ADDED Requirements

### Requirement: Capture user prompts as observation rows
The system SHALL capture the user's prompt text at `before_agent_start` and write it as a `type = "prompt"` row in the observations table.

The row SHALL contain:
- `type`: "prompt"
- `text`: The user's prompt text
- `title`: First 80 characters of the prompt
- `tool_name`: empty string
- `session_id`: Current session ID
- `project`: Current project slug
- `timestamp`: Current ISO 8601 timestamp
- `vector`: null (no embedding)

#### Scenario: First prompt in session captured
- **WHEN** the user sends their first prompt in a session
- **THEN** the system writes a `type = "prompt"` row with the prompt text

#### Scenario: Subsequent prompts in session captured
- **WHEN** the user sends a follow-up prompt within the same session
- **THEN** a new `type = "prompt"` row is written with a new timestamp

#### Scenario: Prompt searchable via FTS
- **WHEN** a prompt has been captured with text "fix the auth bug in login.ts"
- **THEN** a `search({ query: "auth bug login" })` call returns the prompt row

#### Scenario: Empty or trivial prompts still captured
- **WHEN** the user sends a minimal prompt (e.g., "yes" or "continue")
- **THEN** the system still captures it as a prompt row (useful for timeline context)
