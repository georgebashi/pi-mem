## ADDED Requirements

### Requirement: Markdown directory structure
The system SHALL store all memory data in `~/.pi-mem/` using the following directory structure:

```
~/.pi-mem/
├── projects/
│   └── <project-slug>/
│       ├── index.md
│       ├── sessions/
│       │   └── <timestamp>_<session-id>.md
│       └── memories/
│           └── <timestamp>_<session-id>.md
├── lancedb/
└── config.json
```

#### Scenario: Directory structure created on first use
- **WHEN** the extension captures its first observation for a project
- **THEN** the system creates `~/.pi-mem/projects/<project-slug>/sessions/` and `~/.pi-mem/projects/<project-slug>/memories/` directories if they do not exist

#### Scenario: Multiple projects stored independently
- **WHEN** the user works on project A then switches to project B
- **THEN** each project has its own directory under `~/.pi-mem/projects/` with independent session and memory files

### Requirement: Project identity from git remote
The system SHALL derive the project slug from `git remote get-url origin`, normalized to a filesystem-safe string. If no git remote is available, the system SHALL fall back to the basename of the current working directory.

**Normalization rules:**
- `git@github.com:user/repo.git` → `github.com-user-repo`
- `https://github.com/user/repo` → `github.com-user-repo`
- Strip protocol, replace `/` and `:` with `-`, remove `.git` suffix

#### Scenario: Project identified from git SSH remote
- **WHEN** the cwd is a git repo with remote `git@github.com:acme/widget.git`
- **THEN** the project slug is `github.com-acme-widget`

#### Scenario: Project identified from git HTTPS remote
- **WHEN** the cwd is a git repo with remote `https://github.com/acme/widget`
- **THEN** the project slug is `github.com-acme-widget`

#### Scenario: Non-git directory falls back to basename
- **WHEN** the cwd is `/Users/dev/my-scripts` with no `.git` directory
- **THEN** the project slug is `my-scripts`

### Requirement: Session file format
The system SHALL write raw session files in markdown format with a YAML-like header and chronologically ordered observations.

The file SHALL begin with:
- `# Session: <ISO-timestamp>`
- `**Project:** <project-slug>`
- `**Prompt:** "<user-prompt>"`
- `**Started:** <ISO-timestamp>`

Each observation SHALL be formatted as:
- `### [HH:MM:SS] <tool-name>`
- `- **Input:** <JSON or summary>`
- `- **Output:** <text or summary>`

#### Scenario: Session file is human-readable
- **WHEN** a user opens a session file in any text editor or markdown viewer
- **THEN** the file is readable and navigable with clear section headers and timestamps

#### Scenario: Session file is append-only during session
- **WHEN** multiple tool results are captured during a session
- **THEN** each observation is appended to the end of the file, never overwriting previous content

### Requirement: Memory file format
The system SHALL write compressed memory files in markdown format with structured sections matching the session summary output (Request, What Was Investigated, What Was Learned, What Was Completed, Next Steps, Files, Concepts).

#### Scenario: Memory file contains all required sections
- **WHEN** a session summary is generated
- **THEN** the memory file contains headers for all required sections, even if some sections are empty (marked as "None")

#### Scenario: Memory file includes frontmatter metadata
- **WHEN** a memory file is written
- **THEN** the file includes metadata at the top: project slug, date, session ID, and a list of concept tags

### Requirement: Config file for user preferences
The system SHALL support an optional `~/.pi-mem/config.json` file for user preferences.

Configurable settings SHALL include:
- `enabled`: boolean (default: true) — enable/disable the extension
- `autoInject`: boolean (default: true) — enable/disable automatic context injection
- `maxObservationLength`: number (default: 4000) — max chars per tool output
- `summaryModel`: string (optional) — override model for summarization
- `indexSize`: number (default: 10) — max summaries in project index
- `tokenBudget`: number (default: 2000) — max tokens for context injection
- `embeddingModel`: string (optional) — override embedding model for vector search

#### Scenario: Extension uses defaults when no config exists
- **WHEN** `~/.pi-mem/config.json` does not exist
- **THEN** the extension uses default values for all settings

#### Scenario: Partial config merges with defaults
- **WHEN** the config file contains only `{ "tokenBudget": 3000 }`
- **THEN** the extension uses 3000 for tokenBudget and defaults for all other settings
