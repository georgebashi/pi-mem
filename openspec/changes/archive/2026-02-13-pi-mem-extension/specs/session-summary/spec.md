## ADDED Requirements

### Requirement: Generate structured session summary at agent_end
The system SHALL generate an AI-powered session summary at `agent_end` by spawning a headless pi subagent (via the pi SDK's `createAgentSession`) configured for memory compression. The subagent uses `SessionManager.inMemory()`, a compression-specific system prompt, no tools, and a configurable model. The summary SHALL be written to a memory file in `~/.pi-mem/projects/<project>/memories/`.

The summary SHALL contain these sections:
- **Request**: What the user asked for
- **What Was Investigated**: Files read, commands run, areas explored
- **What Was Learned**: Key discoveries, patterns found, system understanding gained
- **What Was Completed**: Changes made, features built, bugs fixed
- **Next Steps**: Remaining work, follow-up items
- **Files**: Lists of files read and files modified
- **Concepts**: Tagged concepts (e.g., bugfix, feature, discovery, how-it-works, problem-solution)

#### Scenario: Summary generated after productive session
- **WHEN** `agent_end` fires and the observation buffer contains 3 or more observations
- **THEN** the system spawns (or reuses) a headless pi subagent with `SessionManager.inMemory()`, no tools, and a compression system prompt, sends the observations as a prompt, parses the structured response, and writes the summary to a memory file

#### Scenario: Trivial session skipped
- **WHEN** `agent_end` fires and the observation buffer contains fewer than 3 observations
- **THEN** the system skips summarization (no memory file created) but still persists the raw session file

#### Scenario: Summarization timeout
- **WHEN** the pi subagent summarization call takes longer than 30 seconds
- **THEN** the system aborts the subagent, logs a warning, and stores the raw observations without a compressed summary

### Requirement: Pi SDK subagent for memory compression
The system SHALL use pi's SDK (`createAgentSession`) to create a dedicated compression subagent. The subagent SHALL be configured with:
- `SessionManager.inMemory()` — no session persistence for the compressor itself
- `tools: []` — no tools, pure text-in/text-out
- A custom `ResourceLoader` with `systemPromptOverride` set to the compression prompt
- A configurable model (default: the user's current model, overridable via `config.json` `summaryModel`)
- No extensions, no skills, no context files

The subagent MAY be reused across multiple `agent_end` cycles within the same pi session to avoid repeated initialization.

#### Scenario: Subagent created on first summarization
- **WHEN** the first `agent_end` fires with sufficient observations and no subagent exists
- **THEN** the system creates a new pi subagent session via `createAgentSession` with the compression configuration

#### Scenario: Subagent reused across prompt cycles
- **WHEN** a second `agent_end` fires and a subagent already exists from a previous cycle
- **THEN** the system reuses the existing subagent session (calling `prompt()` again) rather than creating a new one

#### Scenario: Subagent uses configured model
- **WHEN** `config.json` specifies `"summaryModel": "anthropic/claude-haiku-3"`
- **THEN** the subagent uses Claude Haiku instead of the user's current model

### Requirement: Compression prompt for summarization
The system SHALL use a structured prompt that instructs the LLM to act as a memory compression agent, focusing on what was built/fixed/learned rather than what the observer is doing.

The prompt SHALL instruct the LLM to:
- Focus on deliverables and capabilities (what the system NOW DOES differently)
- Use action verbs (implemented, fixed, deployed, configured, migrated)
- Skip routine operations (empty status checks, simple file listings, package installs)
- Extract concept tags from a fixed vocabulary
- List all files touched with their read/modified status

#### Scenario: Compression prompt produces structured output
- **WHEN** the system sends 10 raw observations about fixing a bug in auth.ts
- **THEN** the LLM returns a summary with all required sections filled in, focusing on what was fixed and learned, not on the observation process itself

#### Scenario: Compression prompt handles mixed-tool sessions
- **WHEN** the observations include a mix of `read`, `bash`, `edit`, and `write` tool calls
- **THEN** the summary correctly categorizes investigated vs completed work

### Requirement: Update project index after summarization
The system SHALL update the project's `index.md` file after each new summary is created. The index SHALL contain a rolling list of the last N session summaries (default: 10) with one-line descriptions.

#### Scenario: Index updated with new summary
- **WHEN** a new session summary is written to `memories/`
- **THEN** the project's `index.md` is updated to include the new summary at the top, with the oldest entry dropped if the list exceeds the configured maximum

#### Scenario: First session for project creates index
- **WHEN** a summary is created for a project that has no `index.md`
- **THEN** the system creates `index.md` with a project header and the first summary entry
