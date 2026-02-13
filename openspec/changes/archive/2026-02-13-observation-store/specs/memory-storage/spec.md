## MODIFIED Requirements

### Requirement: LanceDB as sole primary store
The system SHALL store all data in the LanceDB `observations` table at `~/.pi-mem/lancedb/`. Markdown files (session files, memory files, index files) SHALL NOT be written or read.

The directory structure SHALL be:
```
~/.pi-mem/
├── lancedb/          # LanceDB database (observations table)
└── config.json       # Optional config (also checked at ~/.pi/agent/pi-mem.json)
```

#### Scenario: No markdown directories created
- **WHEN** the extension starts for a new project
- **THEN** the system does NOT create `sessions/`, `memories/`, or `index.md` under `~/.pi-mem/projects/`

#### Scenario: Existing markdown files ignored
- **WHEN** the extension starts and old markdown files exist from a previous version
- **THEN** the system does not read or modify them

### Requirement: Project identity from git remote
The system SHALL derive the project slug from `git remote get-url origin`, normalized to a filesystem-safe string. If no git remote is available, the system SHALL fall back to the basename of the current working directory.

#### Scenario: Project identified from git SSH remote
- **WHEN** the cwd is a git repo with remote `git@github.com:acme/widget.git`
- **THEN** the project slug is `github.com-acme-widget`

#### Scenario: Non-git directory falls back to basename
- **WHEN** the cwd is `/Users/dev/my-scripts` with no `.git` directory
- **THEN** the project slug is `my-scripts`

### Requirement: Config file for user preferences
The system SHALL support config at `~/.pi/agent/pi-mem.json` (primary) with fallback to `~/.pi-mem/config.json`.

Configurable settings SHALL include:
- `enabled`: boolean (default: true)
- `autoInject`: boolean (default: true)
- `maxObservationLength`: number (default: 4000)
- `summaryModel`: string (optional) — override model for summarization
- `thinkingLevel`: string (optional) — thinking level for summarization
- `indexSize`: number (default: 10) — max summaries in context injection
- `tokenBudget`: number (default: 2000) — max tokens for context injection
- `embeddingProvider`: string (optional) — pi provider for embeddings
- `embeddingModel`: string (optional) — embedding model name

#### Scenario: Extension uses defaults when no config exists
- **WHEN** neither config file exists
- **THEN** the extension uses default values for all settings

#### Scenario: Partial config merges with defaults
- **WHEN** the config file contains only `{ "tokenBudget": 3000 }`
- **THEN** the extension uses 3000 for tokenBudget and defaults for all other settings

## REMOVED Requirements

### Requirement: Markdown directory structure
**Reason**: LanceDB replaces markdown files as the primary store. The `~/.pi-mem/projects/<slug>/sessions/`, `memories/`, and `index.md` structure is eliminated.
**Migration**: Remove `storage.ts` directory management (sessions/memories dirs), `memory-writer.ts`, `memory-reader.ts`, `session-writer.ts`, `index-updater.ts`, `index-reader.ts`. Existing files remain on disk but are not read. Users can delete them manually.

### Requirement: Session file format
**Reason**: Raw session markdown files are eliminated. Observations are stored as individual LanceDB rows.
**Migration**: Remove `session-writer.ts`. Raw observation data is available via `get_observations` tool.

### Requirement: Memory file format
**Reason**: Compressed memory markdown files are eliminated. Summaries are stored as LanceDB rows with `type = "summary"`.
**Migration**: Remove `memory-writer.ts` and `memory-reader.ts`. Summary data is available via `get_observations` tool.
