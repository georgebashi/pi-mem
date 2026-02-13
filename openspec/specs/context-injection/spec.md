## MODIFIED Requirements

### Requirement: Inject context at before_agent_start
The system SHALL inject relevant past memories into the LLM context on every `before_agent_start` event by querying the LanceDB `observations` table.

The injected context SHALL contain three sections (in priority order within the token budget):
1. **Recent summaries index**: Query `type = 'summary' AND project = '...'`, ordered by timestamp DESC, limited to `config.indexSize`. Display as compact one-line entries: `- date [session_id]: title`.
2. **Prompt-aware semantic search**: If embeddings are available, compute embedding of user prompt and run `vectorSearch()` with `where("project = '...'")`. Display top 2-3 results as `### Relevant: date [session_id]\ntext_excerpt`.
3. **Workflow guidance**: Static text explaining the 3-layer search pattern (search → timeline → get_observations).

#### Scenario: Context injected for known project
- **WHEN** a user sends a prompt in a project with existing observations
- **THEN** the system queries LanceDB for recent summaries and prompt-relevant results, formats them within the token budget, and injects via `before_agent_start`

#### Scenario: No context for unknown project
- **WHEN** a user starts a session in a directory with no prior observations
- **THEN** the system injects only the workflow guidance text (no summaries, no search results)

#### Scenario: Workflow guidance always included
- **WHEN** `before_agent_start` fires and pi-mem is enabled
- **THEN** the injected context includes the 3-layer workflow guidance text, even if no project memories exist

### Requirement: Token budget for injected context
The system SHALL cap the total injected context at a configurable token budget (default: 2000 tokens). Context is prioritized: recent summaries index first, then semantic search results, then workflow guidance.

#### Scenario: Context fits within budget
- **WHEN** the summaries index (400 tokens) + semantic results (600 tokens) + workflow guidance (100 tokens) = 1100 tokens
- **THEN** all content is injected

#### Scenario: Context exceeds budget
- **WHEN** the summaries index + semantic results would exceed the budget
- **THEN** the system reduces the number of summaries and/or semantic results to stay within budget

### Requirement: Configurable auto-injection
The system SHALL support disabling automatic context injection via config (`"autoInject": false`). When disabled, the search tools are still available for manual use.

#### Scenario: Auto-injection disabled
- **WHEN** config specifies `"autoInject": false`
- **THEN** `before_agent_start` does not inject any memory context

#### Scenario: Auto-injection enabled (default)
- **WHEN** no `autoInject` setting exists in config
- **THEN** the system injects memory context on every `before_agent_start`

## REMOVED Requirements

### Requirement: Progressive disclosure in injected context
**Reason**: The injected context now includes workflow guidance that directs the agent to use the new search tools (search → timeline → get_observations). The old hint to "use mem_search" is replaced by the 3-layer workflow guidance.
**Migration**: Replace the `mem_search` hint with the 3-layer workflow guidance text.
