## ADDED Requirements

### Requirement: Inject context at before_agent_start
The system SHALL inject relevant past memories into the LLM context on every `before_agent_start` event. The injection uses pi's `before_agent_start` return value to provide both a system prompt addendum and a context message.

#### Scenario: Context injected on first prompt of session
- **WHEN** a user sends their first prompt in a new session for a known project
- **THEN** the system injects the project's `index.md` content and the last 2-3 session summaries as a context message via `before_agent_start`

#### Scenario: Context injected on subsequent prompts
- **WHEN** a user sends a follow-up prompt within the same session
- **THEN** the system injects context again (it may have changed due to compaction or new memories from parallel sessions)

#### Scenario: No context injected for unknown project
- **WHEN** a user starts a session in a directory with no prior memories
- **THEN** the system injects no memory context (no `index.md` exists, no memories to load)

### Requirement: Token budget for injected context
The system SHALL cap the total injected context at a configurable token budget (default: 2000 tokens). Context is prioritized: project index first, then most recent summaries, then vector search results relevant to the current prompt.

#### Scenario: Context fits within budget
- **WHEN** the project index (200 tokens) + last 2 summaries (600 tokens each) = 1400 tokens total
- **THEN** all content is injected (under the 2000 token budget)

#### Scenario: Context exceeds budget
- **WHEN** the project index + last 3 summaries would total 2800 tokens
- **THEN** the system includes the project index + last 2 summaries (drops the oldest) to stay within budget

#### Scenario: Custom token budget from config
- **WHEN** `config.json` specifies `"tokenBudget": 4000`
- **THEN** the system uses 4000 as the token limit for context injection

### Requirement: Progressive disclosure in injected context
The system SHALL use progressive disclosure in injected context: show compact one-line summaries first, with full details available via `mem_search`. The injected context SHALL include a note telling the LLM that `mem_search` is available for deeper investigation.

#### Scenario: Compact format with search hint
- **WHEN** context is injected at session start
- **THEN** each past session is shown as a one-line entry (date + request + key outcome), followed by a note: "Use the mem_search tool to find detailed information about past sessions."

### Requirement: Prompt-aware context injection
The system SHALL optionally include vector search results relevant to the user's current prompt in the injected context. This enables the LLM to receive targeted memories without explicitly searching.

#### Scenario: Relevant memories included for prompt
- **WHEN** a user asks "continue working on the auth refactor" and vector search finds 2 relevant memories about auth work
- **THEN** the injected context includes those 2 memories (within token budget) in addition to the standard recent summaries

#### Scenario: Vector search unavailable
- **WHEN** LanceDB is not available for prompt-aware injection
- **THEN** the system falls back to injecting only the project index and recent summaries (no prompt-specific results)

### Requirement: Configurable auto-injection
The system SHALL support disabling automatic context injection via `config.json` (`"autoInject": false`). When disabled, the LLM can still use `mem_search` manually.

#### Scenario: Auto-injection disabled
- **WHEN** `config.json` specifies `"autoInject": false`
- **THEN** the `before_agent_start` handler does not inject any memory context

#### Scenario: Auto-injection enabled (default)
- **WHEN** no `autoInject` setting exists in `config.json`
- **THEN** the system injects memory context on every `before_agent_start`
