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
- `stop()` — interrupt current response (kills process, preserves messages)
- `restart()` — kill session and start fresh
- `kill()` — terminate
- `onEvent(callback)` — receive stream events

### Stream Events

| Event | Meaning |
|---|---|
| `content` | Full blocks array from cumulative assistant message (replaces previous snapshot) |
| `done` | Turn complete |
| `error` | Error message |

### Content Blocks

| Type | Data |
|---|---|
| `text` | Plain text string |
| `table` | Headers + rows (amounts get semantic coloring) |
| `bar-chart` | Title + label/value pairs |
| `donut-chart` | Title + label/value pairs |
| `tool-activity` | Tool name (persists in chat history) |

`BlockRenderer` routes each block to its specialized renderer. New types are added by extending the union and adding a renderer.

### Streaming Behavior

Content blocks are **append-only** in the UI:
- Text blocks: cumulative growth detected by prefix matching — the last text block is updated in-place. New text (from a different sub-message) is appended as a separate block.
- Non-text blocks (tool activity, tables, charts): always appended, never replaced.
- Between sub-messages (after tool results), Claude CLI starts a fresh cumulative array. The handler detects this and appends rather than replacing.

## Desktop Adapter: Claude CLI

The desktop shell spawns Claude Code CLI as a long-lived subprocess via Tauri's shell plugin.

### CLI Flags

- `-p` — pipe mode
- `--input-format stream-json` / `--output-format stream-json`
- `--session-id <uuid>` — conversation context
- `--mcp-config <path>` — points to MCP server
- `--allowedTools "mcp__capy__*,Read"` — allowlist MCP tools + file reading
- `--add-dir <budget-path>` — grant Read access to the budget folder
- `--setting-sources ""` — skip CLAUDE.md files

### Process Lifecycle

- Spawn on first message (lazy, not on overlay open)
- Fresh session ID (UUID) on each spawn
- Process stays alive regardless of overlay state — close/reopen preserves conversation
- "New Chat" kills and respawns with fresh session ID
- On budget close: kill process

### Stop & Session Recovery

When the user stops a response:
1. Process is killed, new session ID generated
2. UI shows "Session interrupted" separator
3. Next message serializes previous conversation (~5K chars of text + tool activity) and prepends it as `[Previous conversation]` context
4. Claude receives the context and can pick up the conversation or ask for clarification

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
- `tool_use` — MCP tool call (render tool → content block, data tool → tool-activity block)

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

### Tools

Data tools (read-only): `list_accounts`, `list_transactions`, `list_categories`, `spending_summary`.

Mutation tools (write): full CRUD for transactions, accounts, and categories plus `assign_categories` for bulk operations. All mutations reuse `@capybudget/core` pure functions. See `packages/mcp/src/data-tools.ts` and `mutation-tools.ts` for the complete list and schemas.

The MCP server runs with `immediate: true` on the repository — writes flush to disk before returning tool results. SIGTERM/SIGINT handlers call `repo.dispose()` for graceful shutdown.

When the app detects mutation tool activity during a turn, it invalidates the repo's in-memory cache and React Query data on turn completion — so the UI reflects Claude's changes.

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
Date: March 15, 2026
Budget folder: /Users/vlad/budgets/capy

[User message]
What did I spend on food this month?
```

## Custom Instructions

Users can write custom instructions in `capy-instructions.md` in the budget folder. These are composed into the system prompt at session start:

```
{SYSTEM_PROMPT}

## User instructions
{contents of capy-instructions.md}
```

User-provided, takes effect on next session.

## Custom Commands

Quick command templates stored as `capy-commands.json` in the budget folder. 3 defaults provided (spending breakdown, subscriptions audit, savings rate). Users can add, edit, and delete commands. Sorted alphabetically.

## System Prompt

Establishes Capy's personality:
- Financial assistant with full CRUD capabilities
- Takes action directly — never tells user to do things in the UI
- Uses render tools for all structured output (tables, charts)
- Defaults to current month when no date range specified
- Concise, direct answers
- Confirms destructive actions before executing

Includes a complete data model description and tool reference so the AI interprets results correctly.
