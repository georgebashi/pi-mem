## ADDED Requirements

### Requirement: Observer agent extracts structured observations from tool outputs

The system SHALL spawn a dedicated LLM observer agent for each `tool_result` event that receives the full, untruncated tool input and output and produces a structured observation with fields: type, title, subtitle, facts, narrative, concepts, files_read, files_modified.

#### Scenario: File read observation
- **WHEN** a `read` tool_result is captured with a 19K-char file output
- **THEN** the observer agent receives the full 19K-char output and returns an observation with a meaningful title, facts about what the file contains, a narrative describing its purpose, and the file path in files_read

#### Scenario: Bash command observation
- **WHEN** a `bash` tool_result is captured with command output
- **THEN** the observer agent receives the full output and extracts relevant facts about what the command accomplished, any errors, and files mentioned in the output

#### Scenario: Edit/write observation
- **WHEN** an `edit` or `write` tool_result is captured
- **THEN** the observer agent extracts what was changed, why, and lists the file in files_modified

### Requirement: Observer agent produces XML-formatted observations

The observer agent SHALL output observations in XML format with the following structure: `<observation>` containing `<type>`, `<title>`, `<subtitle>`, `<facts>` (with `<fact>` children), `<narrative>`, `<concepts>` (with `<concept>` children), `<files_read>` (with `<file>` children), and `<files_modified>` (with `<file>` children).

#### Scenario: Valid XML output
- **WHEN** the observer agent processes a tool_result
- **THEN** it produces output containing one `<observation>` XML block with all required child elements

#### Scenario: XML parsing extracts all fields
- **WHEN** the system parses the observer's XML output
- **THEN** it extracts type, title, subtitle, facts array, narrative, concepts array, files_read array, and files_modified array into structured data

### Requirement: Observation types follow a fixed taxonomy

The system SHALL accept only these observation types: `bugfix`, `feature`, `refactor`, `change`, `discovery`, `decision`. If the observer produces an unrecognized type, the system SHALL fall back to `change`.

#### Scenario: Valid observation type
- **WHEN** the observer outputs `<type>discovery</type>`
- **THEN** the observation is stored with obs_type = "discovery"

#### Scenario: Invalid observation type
- **WHEN** the observer outputs `<type>investigation</type>`
- **THEN** the observation is stored with obs_type = "change" (fallback)

### Requirement: Concepts follow a fixed taxonomy

The system SHALL accept only these concept values: `how-it-works`, `why-it-exists`, `what-changed`, `problem-solution`, `gotcha`, `pattern`, `trade-off`. Unrecognized concepts SHALL be silently dropped.

#### Scenario: Valid concepts
- **WHEN** the observer outputs `<concept>how-it-works</concept>` and `<concept>gotcha</concept>`
- **THEN** both concepts are stored in the observation

#### Scenario: Mixed valid and invalid concepts
- **WHEN** the observer outputs `<concept>how-it-works</concept>` and `<concept>interesting</concept>`
- **THEN** only "how-it-works" is stored; "interesting" is silently dropped

### Requirement: Observer receives full untruncated tool output

The system SHALL NOT truncate tool output before sending it to the observer agent. The `truncateOutput()` function SHALL NOT be applied to tool outputs destined for the observer.

#### Scenario: Large file read
- **WHEN** a `read` tool_result produces 20K chars of output
- **THEN** the observer agent receives all 20K chars in its prompt

#### Scenario: Large bash output
- **WHEN** a `bash` tool_result produces 50K chars of output
- **THEN** the observer agent receives all 50K chars in its prompt

### Requirement: Observer extraction is asynchronous and non-blocking

The system SHALL run observer extraction asynchronously so it does not block the main coding session. The `tool_result` handler SHALL return immediately after queuing the observation for extraction.

#### Scenario: Normal extraction
- **WHEN** a tool_result is captured
- **THEN** the main session continues immediately while extraction runs in the background

#### Scenario: Slow extraction
- **WHEN** the observer LLM takes 5 seconds to respond
- **THEN** the main session is unaffected; the observation is stored when extraction completes

### Requirement: Observer failure drops the observation

If the observer agent fails (timeout, spawn error, invalid output), the system SHALL silently drop the observation. No raw text fallback is stored. Fire-and-forget is intentional.

#### Scenario: Observer timeout
- **WHEN** the observer agent does not respond within 30 seconds
- **THEN** no observation is stored for that tool execution

#### Scenario: Observer spawn failure
- **WHEN** the `pi` subprocess fails to spawn
- **THEN** no observation is stored for that tool execution

#### Scenario: Observer returns no observation XML
- **WHEN** the observer returns text without any `<observation>` block
- **THEN** no observation is stored for that tool execution

### Requirement: Skip low-value tool executions

The system SHALL skip observer extraction for: pi-mem's own tools (search, timeline, get_observations, save_memory), tool outputs shorter than 50 characters, and tool executions that match configured ignore patterns. Skipped observations SHALL NOT be stored at all.

#### Scenario: Pi-mem tool skipped
- **WHEN** a `search` tool_result from pi-mem is captured
- **THEN** no observation is stored and no observer LLM call is made

#### Scenario: Trivial output skipped
- **WHEN** a tool_result has output of only 30 characters
- **THEN** no observation is stored and no observer LLM call is made

### Requirement: Structured observations stored in LanceDB with clean schema

The system SHALL store observations in a LanceDB table with columns: id, session_id, project, type, obs_type, timestamp, tool_name, title, subtitle, facts (JSON string), narrative, concepts (JSON string), files_read (JSON string), files_modified (JSON string), vector. On first run with no existing table, the system SHALL create the table. On first run with an existing table from the old schema, the system SHALL drop it and recreate with the new schema.

#### Scenario: First run with no data
- **WHEN** the system initializes and no LanceDB table exists
- **THEN** a new table is created with the structured schema

#### Scenario: First run with old schema data
- **WHEN** the system initializes and finds an existing `observations` table
- **THEN** the old table is dropped and a new table is created with the structured schema

#### Scenario: Observation stored with all fields
- **WHEN** the observer extracts a complete observation
- **THEN** it is stored with all structured fields populated, and the narrative is FTS-indexed

### Requirement: FTS search indexes on narrative and title

The system SHALL create FTS indexes on the `narrative` column for full-text search. Search results SHALL return structured fields (id, session_id, project, type, obs_type, timestamp, tool_name, title, subtitle) as compact index results.

#### Scenario: Search by keyword
- **WHEN** a user searches for "authentication"
- **THEN** observations whose narrative or title contains "authentication" are returned as compact index results

### Requirement: Session summaries aggregate structured observations

At `agent_end`, the system SHALL produce a session summary by sending structured observation data (title + narrative for each observation) to a summarization LLM. The summary prompt SHALL use the extracted titles and narratives, not raw tool output.

#### Scenario: Summary from structured observations
- **WHEN** a session ends with 10 observations that have extracted titles and narratives
- **THEN** the summarization prompt includes all 10 titles and narratives (not raw tool output)

#### Scenario: Summary quality with structured data
- **WHEN** a session read 5 large files (each 15K+ chars)
- **THEN** the summary accurately describes what was in those files because the observer extracted meaningful narratives from the full content

### Requirement: Observer model is configurable

The system SHALL support an `observerModel` configuration option. If not set, it SHALL fall back to `summaryModel`, then to the current session model. This allows users to use a cheap/fast model for observation extraction.

#### Scenario: Explicit observer model
- **WHEN** config has `observerModel: "provider/model-name"`
- **THEN** the observer uses that model for extraction

#### Scenario: Fallback to summary model
- **WHEN** config has no `observerModel` but has `summaryModel: "provider/model-name"`
- **THEN** the observer uses the summary model

#### Scenario: Fallback to session model
- **WHEN** config has neither `observerModel` nor `summaryModel`
- **THEN** the observer uses whatever model the current pi session is using

### Requirement: Observer prompt follows mode configuration

The system SHALL define a mode configuration (as a TypeScript constant) that specifies: observation types with descriptions, concept categories with descriptions, system identity prompt, observer role prompt, recording focus guidance, skip guidance, and XML output format template. The observer agent's prompt SHALL be constructed from this mode configuration.

#### Scenario: Mode defines observation types
- **WHEN** the mode configuration lists 6 observation types
- **THEN** the observer prompt includes all 6 types with descriptions in the XML schema comment

#### Scenario: Mode defines concept categories
- **WHEN** the mode configuration lists 7 concept categories
- **THEN** the observer prompt includes all 7 concepts with descriptions

### Requirement: Three-layer search API returns structured fields

The search tool SHALL return compact index results (id, session_id, project, type, obs_type, timestamp, tool_name, title, subtitle). The timeline tool SHALL return medium-detail results (index fields plus narrative preview). The get_observations tool SHALL return full-detail results (all structured fields including facts, full narrative, concepts, files_read, files_modified).

#### Scenario: Search returns compact results
- **WHEN** the search tool is called with a query
- **THEN** results include id, title, subtitle, obs_type, and other index fields — but not narrative or facts

#### Scenario: Get observations returns full detail
- **WHEN** get_observations is called with specific IDs
- **THEN** results include all fields: title, subtitle, facts array, narrative, concepts array, files_read, files_modified

### Requirement: Files are cross-checked with deterministic extraction

The system SHALL extract file paths deterministically from tool input (e.g., `path` field for read/edit/write tools). These deterministic file paths SHALL be used as ground truth for files_read and files_modified, supplemented by any additional files the observer LLM identifies in tool output.

#### Scenario: Read tool file path
- **WHEN** a `read` tool has `input.path = "src/index.ts"`
- **THEN** `files_read` includes "src/index.ts" regardless of what the observer extracts

#### Scenario: Observer identifies additional files
- **WHEN** a `bash` tool output mentions "modified src/config.ts" and the observer extracts it
- **THEN** `files_modified` includes "src/config.ts" from the observer, merged with any deterministic paths
