# Intelligence Layer

Capy is an AI financial assistant that lives inside the budget app. It's powered by Claude Code CLI running as a subprocess — the app sends messages, Claude streams responses, and an MCP server gives Claude structured access to the user's financial data.

The app is fully functional without it. Intelligence is additive.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Capy Overlay (React)                                    │
│  Messages, input, rich content blocks                    │
└────────────┬─────────────────────────────────────────────┘
             │ Tauri shell plugin
             ▼
┌──────────────────────────────────────────────────────────┐
│  claude CLI (long-lived subprocess)                       │
│  stream-json stdin/stdout, session persistence            │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  MCP Server (TypeScript)                           │  │
│  │  Exposes domain data as structured tools           │  │
│  │  Shares service layer with the UI                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│  Budget Data (CSV files)                                 │
│  accounts.csv, transactions.csv, categories.csv          │
└──────────────────────────────────────────────────────────┘
```

The MCP server mirrors the CSV reading logic from the UI's service layer. It runs as a standalone Node/tsx process (outside Vite), so it duplicates type definitions and CSV parsing rather than importing from `src/`. The data model is the single source of truth — the MCP server is a read-only consumer.

## Claude CLI Process

Spawn once via Tauri's shell plugin. The process lives in the background for the lifetime of the budget — not tied to the overlay being open.

```
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --verbose \
  --mcp-config <json> \
  --system-prompt <prompt> \
  --session-id <uuid> \
  --allowedTools "mcp__capy__*" \
  --setting-sources ""
```

Key flags:
- `-p` — pipe mode (non-interactive)
- `--session-id` — new UUID per spawn, maintains conversation context
- `--allowedTools` — allowlist MCP tools so Claude doesn't prompt for permission
- `--setting-sources ""` — skip CLAUDE.md files, we control the prompt
- Remove `CLAUDECODE` env var before spawning to prevent nested session detection

### Lifecycle

- Spawn on first message (not on overlay open — lazy)
- Generate fresh session ID on each spawn
- Take stdout once, pipe into a background event reader
- Process stays alive in the background regardless of overlay state — the user can close and reopen the overlay without losing conversation context
- "New Chat" kills the current process and respawns with a fresh session ID
- On budget close / unmount: kill process

### Error Recovery

When the CLI process dies unexpectedly:

1. Detect via the process exit event from Tauri's shell plugin
2. Show a non-blocking notice in the chat prompting the user to send a message
3. The next `send()` call lazily spawns a fresh process with a new session ID
4. The chat UI keeps the old messages for display (scrollback), but Claude has no memory of them — the conversation effectively starts fresh

No retry logic, no history replay, no auto-respawn. A crash is a clean slate. This is simple, predictable, and avoids the complexity of serializing conversation state.

## Streaming Protocol

### Sending (stdin)

```json
{"type":"user","message":{"role":"user","content":"What did I spend on food?"}}
```

### Receiving (stdout)

Each line is a JSON object. The app cares about:

| `type` | Meaning | Action |
|--------|---------|--------|
| `assistant` | Content chunk | Extract last content block from `.message.content[]` |
| `result` | Turn complete | Mark streaming done |
| `error` | Error | Show error in chat |

Content blocks within `assistant` messages:
- `text` — cumulative text (replace, don't append)
- `tool_use` — Claude is calling an MCP tool (show activity indicator)

### Frontend Event Types

```typescript
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool-activity"; tool: string }
  | { type: "done" }
  | { type: "error"; message: string }
```

## MCP Server

A TypeScript MCP server that the `claude` CLI spawns as a child process. It exposes budget data through structured tools.

### Why TypeScript

All domain logic already lives in `src/services/` as pure functions. The MCP server imports and reuses them — no duplication, no cross-language type sync. The server runs as a Node/tsx process, communicating with `claude` over stdio.

### Tools (initial set)

| Tool | Purpose |
|------|---------|
| `list_accounts` | All accounts with balances |
| `list_transactions` | Transactions with filters (account, category, date range, merchant) |
| `list_categories` | Category tree (groups and categories) |
| `spending_summary` | Aggregated spending by category for a date range |

Tools are read-only initially. Write tools (add transaction, categorize, etc.) come later.

### MCP Config

```json
{
  "mcpServers": {
    "capy": {
      "command": "tsx",
      "args": ["path/to/capy-mcp-server.ts"],
      "env": { "BUDGET_PATH": "/path/to/budget/folder" }
    }
  }
}
```

The budget path is injected as an env var so the MCP server can read CSV files independently.

## Context Enrichment

Each user message is wrapped with current app context before sending to Claude:

```
[Context]
Budget: personal
Date: March 13, 2026

[User message]
What did I spend on food this month?
```

Currently includes budget name and date. Future enrichment (current view, account balances, transaction count) can be added as `buildContext()` grows.

## Rich Content Blocks

Claude's responses are rendered as a sequence of typed content blocks:

| Block type | Renders as |
|------------|------------|
| `text` | Markdown paragraph |
| `table` | Data table with typed columns (amounts get coloring) |
| `bar-chart` | Horizontal bars with labels and values |
| `donut-chart` | SVG pie chart with legend |

The `BlockRenderer` component routes each block to its specialized renderer. New block types are added by extending the union type and adding a renderer — the overlay doesn't change.

### Structured Output via Render Tools

Claude uses MCP tools to emit rich content. Text is streamed naturally; structured blocks (tables, charts) arrive as tool calls with typed JSON payloads. The frontend intercepts these and renders them inline in the message.

#### Render Tools

| Tool | Input schema | Renders as |
|------|-------------|------------|
| `render_table` | `{ headers: string[], rows: string[][] }` | Data table with amount coloring |
| `render_bar_chart` | `{ title: string, data: { label: string, value: number }[] }` | Horizontal bar chart |
| `render_donut_chart` | `{ title: string, data: { label: string, value: number }[] }` | SVG donut chart with legend |

These tools are no-ops on the MCP server side — they return an empty acknowledgment. Their only purpose is to carry structured data from Claude to the frontend via the `tool_use` / `tool_result` stream events.

#### Stream Integration

Within a single assistant turn, the stream interleaves text and tool calls:

1. `assistant` event with `text` content block → append to current message text
2. `assistant` event with `tool_use` block for `render_*` → parse input, push a rich content block into the message
3. `assistant` event with `tool_use` block for data tools (`list_transactions`, etc.) → show activity indicator ("Reading transactions...")
4. `result` event → mark turn complete

The system prompt instructs Claude to use render tools for any structured data rather than formatting tables as markdown. This keeps the rendering pipeline clean — text is text, structured data is structured data.

## System Prompt

The system prompt establishes Capy's personality and capabilities:

- Financial assistant for personal budgeting
- Has access to the user's transaction, account, and category data via tools
- Defaults to current month when no date range specified
- Shows amounts formatted as currency
- Concise — answers directly, avoids filler
- When suggesting changes (categorization, etc.), always present a preview for user confirmation

The prompt includes a description of the data model (account types, transaction types, category structure) so Claude can interpret tool results correctly.

## Language Boundary

The Tauri shell plugin handles process spawning from the Rust side transparently. All orchestration logic (message formatting, stream parsing, state management) stays in TypeScript. The MCP server is TypeScript. No data structures cross the Rust/TypeScript boundary beyond the shell plugin's built-in event types (stdout line, stderr line, process exit).

If the shell plugin's JS API proves insufficient for reliable streaming (buffering issues, etc.), the fallback is a thin Rust command that manages the subprocess and emits Tauri events — but the parsed/typed data structures still live only in TypeScript.
