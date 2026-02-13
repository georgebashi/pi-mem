## MODIFIED Requirements

### Requirement: Generate structured session summary at agent_end
The system SHALL generate an AI-powered session summary at `agent_end` by spawning a `pi` subprocess with `--mode json`. Instead of reading from an in-memory buffer, the system SHALL query observations from LanceDB: `table.query().where("session_id = '...' AND type = 'observation'").orderBy("timestamp ASC").toArray()`.

The summary SHALL be written as a `type = "summary"` row in the `observations` table with an embedding vector. The summary row SHALL contain:
- `id`: Short UUID
- `session_id`: Same session ID as the observations
- `project`: Current project slug
- `type`: "summary"
- `timestamp`: Current ISO 8601 timestamp
- `tool_name`: empty string
- `title`: LLM-generated one-line title for the session
- `text`: Full LLM-generated summary text (all sections concatenated)
- `concepts`: Comma-separated concept tags from the LLM output
- `files`: Comma-separated file paths from the LLM output
- `vector`: float[1536] embedding of the text content

The summary text SHALL contain these sections:
- **Request**: What the user asked for
- **What Was Investigated**: Files read, commands run, areas explored
- **What Was Learned**: Key discoveries, patterns found
- **What Was Completed**: Changes made, features built, bugs fixed
- **Next Steps**: Remaining work, follow-up items
- **Files**: Lists of files read and modified
- **Concepts**: Tagged concepts

#### Scenario: Summary generated after productive session
- **WHEN** `agent_end` fires and the session has 3 or more observation rows in LanceDB
- **THEN** the system queries observations from LanceDB, spawns a `pi` subprocess for summarization, and writes the result as a `type = "summary"` row with an embedding vector

#### Scenario: Trivial session skipped
- **WHEN** `agent_end` fires and the session has fewer than 3 observation rows
- **THEN** the system skips summarization (observation rows remain in LanceDB, no summary row created)

#### Scenario: Summarization failure is non-fatal
- **WHEN** the `pi` subprocess fails or times out
- **THEN** the system logs a warning and continues. Observation rows remain in LanceDB.

### Requirement: Compaction and FTS rebuild at agent_end
The system SHALL compact the observations table and rebuild the FTS index at `agent_end` after writing the summary row.

#### Scenario: Compaction and index rebuild after summary
- **WHEN** `agent_end` fires and a summary has been written
- **THEN** the system compacts the table and recreates the FTS index

#### Scenario: Compaction runs even without summary
- **WHEN** `agent_end` fires but summarization was skipped (trivial session)
- **THEN** the system still compacts the table and rebuilds the FTS index if observations were written

## REMOVED Requirements

### Requirement: Update project index after summarization
**Reason**: The `index.md` file is eliminated. The project index is now derived from a LanceDB query at context injection time: `table.query().where("project = '...' AND type = 'summary'").orderBy("timestamp DESC").limit(N)`.
**Migration**: Remove `index-updater.ts` and `index-reader.ts`. Context injection queries LanceDB directly.

### Requirement: Pi SDK subagent for memory compression
**Reason**: Replaced by spawning a `pi` subprocess with `--mode json`. The in-process `createAgentSession` approach was fragile due to the ever-growing `ResourceLoader` interface. The subprocess approach (matching pi-web-fetch) is simpler and stable.
**Migration**: Already done — `compression-agent.ts` uses `spawn("pi", ["--mode", "json", ...])`. No further changes needed.
