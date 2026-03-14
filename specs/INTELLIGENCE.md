# Intelligence Layer

Capy is an AI financial assistant. The app communicates with AI through the `CapySession` interface defined in `@capybudget/intelligence`. The desktop shell implements this with Claude Code CLI as a subprocess. The app is fully functional without intelligence — it's additive.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Capy Overlay (@capybudget/app)              │
│  Messages, input, rich content blocks        │
└──────────────┬───────────────────────────────┘
               │ CapySession interface
               ▼
┌──────────────────────────────────────────────┐
│  Session Adapter (shell-specific)            │
│  Desktop: Claude CLI via Tauri shell         │
│  Demo: stub with sample responses            │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  MCP Server (@capybudget/mcp, standalone)    │
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  Budget Data (via @capybudget/persistence)   │
└──────────────────────────────────────────────┘
```

## Session Interface

`CapySession` in `@capybudget/intelligence` defines the contract:

- `send(message)` — send user message (enriched with context)
- `restart()` — kill session and start fresh
- `kill()` — terminate
- `onEvent(callback)` — receive stream events

### Stream Events

| Event | Meaning |
|---|---|
| `text` | Streamed text (cumulative — replace, don't append) |
| `render` | Rich content block (table, chart) |
| `tool-activity` | AI is calling a data tool (show activity indicator) |
| `done` | Turn complete |
| `error` | Error message |

### Content Blocks

| Type | Data |
|---|---|
| `text` | Markdown string |
| `table` | Headers + rows (amounts get semantic coloring) |
| `bar-chart` | Title + label/value pairs |
| `donut-chart` | Title + label/value pairs |

`BlockRenderer` routes each block to its specialized renderer. New types are added by extending the union and adding a renderer.

## Desktop Adapter: Claude CLI

The desktop shell spawns Claude Code CLI as a long-lived subprocess via Tauri's shell plugin.

### CLI Flags

- `-p` — pipe mode
- `--input-format stream-json` / `--output-format stream-json`
- `--session-id <uuid>` — conversation context
- `--mcp-config <path>` — points to MCP server
- `--allowedTools "mcp__capy__*"` — allowlist MCP tools
- `--setting-sources ""` — skip CLAUDE.md files
- `CLAUDECODE` env var removed to prevent nested detection

### Process Lifecycle

- Spawn on first message (lazy, not on overlay open)
- Fresh session ID (UUID) on each spawn
- Process stays alive regardless of overlay state — close/reopen preserves conversation
- "New Chat" kills and respawns with fresh session ID
- On budget close: kill process

### Error Recovery

When the process dies unexpectedly:
1. Detect via process exit event
2. Show notice prompting user to send a message
3. Next `send()` lazily spawns a fresh process
4. Chat keeps old messages for display, but AI conversation starts fresh

No retry logic, no history replay. A crash is a clean slate.

### Streaming Protocol (CLI-specific)

Sending (stdin):
```json
{"type":"user","message":{"role":"user","content":"What did I spend on food?"}}
```

Receiving (stdout) — each line is a JSON object:

| `type` | Action |
|---|---|
| `assistant` | Extract content blocks from `.message.content[]` |
| `result` | Mark turn complete |
| `error` | Show error in chat |

Content blocks within `assistant` messages:
- `text` — cumulative text
- `tool_use` — MCP tool call (render tool → content block, data tool → activity indicator)

## MCP Server

`@capybudget/mcp` is a standalone TypeScript MCP server communicating over stdio. It works with any MCP-compatible AI agent — Claude Desktop, Cursor, VS Code Copilot, or any tool supporting the protocol.

The desktop app spawns it automatically. External agents configure it manually:

```json
{
  "mcpServers": {
    "capybudget": {
      "command": "npx",
      "args": ["@capybudget/mcp"],
      "env": { "BUDGET_PATH": "/path/to/budget" }
    }
  }
}
```

### Data Tools

| Tool | Purpose |
|---|---|
| `list_accounts` | All accounts with balances |
| `list_transactions` | Transactions with filters (account, category, date range, merchant) |
| `list_categories` | Category tree grouped by group |
| `spending_summary` | Aggregated spending by category for a date range |

Read-only. The MCP server reads budget data through `@capybudget/persistence` with a Node.js file adapter.

### Render Tools

| Tool | Input | Renders as |
|---|---|---|
| `render_table` | `{ headers, rows }` | Data table with amount coloring |
| `render_bar_chart` | `{ title, data: [{label, value}] }` | Horizontal bar chart |
| `render_donut_chart` | `{ title, data: [{label, value}] }` | SVG donut chart with legend |

No-ops on the server — they carry structured data from AI to frontend via tool_use events. The system prompt instructs the AI to use render tools for structured data rather than markdown tables.

## Context Enrichment

Each user message is wrapped with app context before sending:

```
[Context]
Budget: personal
Date: March 13, 2026

[User message]
What did I spend on food this month?
```

## System Prompt

Establishes Capy's personality:
- Financial assistant for personal budgeting
- Uses tools for data access, render tools for structured output
- Defaults to current month when no date range specified
- Concise, direct answers
- Previews changes before applying

Includes a data model description so the AI interprets tool results correctly.
