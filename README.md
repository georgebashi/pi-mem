# pi-mem

Persistent memory extension for [pi](https://github.com/badlogic/pi-mono). Automatically captures what pi does during sessions, compresses observations into searchable memories, and injects relevant context into future sessions.

## Features

- **Automatic observation capture** — hooks into `tool_result` events to record tool executions
- **LLM-powered observation extraction** — extracts structured facts, narrative, concepts, and file references from tool output
- **Session summaries** — compresses observations into searchable memories using checkpoint summarization
- **Vector + full-text search** — LanceDB-backed semantic and keyword search across all memories
- **Context injection** — automatically loads relevant past memories at session start
- **Memory tools** — `search`, `timeline`, `get_observations`, and `save_memory` tools for the LLM
- **Privacy controls** — `<private>` tags to exclude sensitive content
- **Project awareness** — scopes memories per project (from git remote), supports cross-project search

## Installation

```bash
pi install npm:pi-mem
```

Or to try without installing:

```bash
pi -e npm:pi-mem
```

## Configuration

Create `~/.pi/agent/pi-mem.json` or `~/.pi-mem/config.json` (optional — all settings have sensible defaults):

```json
{
  "enabled": true,
  "autoInject": true,
  "maxObservationLength": 4000,
  "summaryModel": "anthropic/claude-haiku-3",
  "indexSize": 10,
  "tokenBudget": 2000,
  "embeddingProvider": "openai",
  "embeddingModel": "text-embedding-3-small",
  "embeddingDims": 1536
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable/disable the extension |
| `autoInject` | `true` | Automatically inject past memories at session start |
| `maxObservationLength` | `4000` | Max characters per tool output observation |
| `summaryModel` | (current model) | Model to use for session summarization |
| `observerModel` | (falls back to summaryModel) | Model for per-tool observation extraction |
| `thinkingLevel` | (current level) | Thinking level for LLM calls |
| `indexSize` | `10` | Max entries in the project memory index |
| `tokenBudget` | `2000` | Max tokens for injected context |
| `embeddingProvider` | (none) | Pi provider name for embeddings. Must support OpenAI-compatible `/v1/embeddings` |
| `embeddingModel` | `text-embedding-3-small` | Embedding model name |
| `embeddingDims` | `1536` | Embedding vector dimensions (must match the model) |

### Embedding Setup

For vector/semantic search, configure an embedding provider. The provider must support the OpenAI-compatible `/v1/embeddings` endpoint. Add the provider name from your `~/.pi/agent/models.json`:

```json
{
  "embeddingProvider": "openai",
  "embeddingModel": "text-embedding-3-small",
  "embeddingDims": 1536
}
```

Without an embedding provider, full-text search still works.

## Data Storage

All data is stored in `~/.pi-mem/`:

```
~/.pi-mem/
├── lancedb/                      # Observation store (LanceDB)
└── config.json                   # User preferences (optional)
```

## Commands

- `/mem` — Show current memory status (project, observation count, vector DB status)

## Tools (available to the LLM)

### search

Search past observations and summaries with full-text search:

```
search({ query: "authentication flow" })
search({ query: "authentication", project: "my-app", limit: 5 })
```

### timeline

Get chronological context around a specific observation:

```
timeline({ anchor: "abc12345" })
timeline({ query: "auth bug", depth_before: 5, depth_after: 5 })
```

### get_observations

Fetch full details for specific observation IDs:

```
get_observations({ ids: ["abc12345", "def67890"] })
```

### save_memory

Explicitly save important information:

```
save_memory({
  text: "Decided to use PostgreSQL for ACID transactions",
  title: "Database choice",
  concepts: ["decision", "architecture"]
})
```

## Privacy

Wrap sensitive content in `<private>` tags in tool output — it will be stripped before observation:

```
API key is <private>sk-abc123</private>
```

## License

MIT
