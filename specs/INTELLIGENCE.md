# Intelligence Layer

Capy is an AI financial assistant. The intelligence layer is **provider-pluggable**: the renderer talks to a `CapySession` interface, and a factory selects one of three concrete adapters at runtime — Claude Code CLI, Anthropic API, or OpenAI API — based on user settings. The app is fully functional without intelligence; it's additive.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Capy Overlay  +  Import Screen              │
│  Messages, input, multimodal attachments     │
└──────────────┬───────────────────────────────┘
               │ CapySession interface
               ▼
┌──────────────────────────────────────────────────────────────┐
│  Session Factory  (provider, config, options)                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ ClaudeCliSession│  │AnthropicSession│  │ OpenAiSession  │  │
│  │ subprocess+MCP  │  │ in-process loop│  │ in-process loop│  │
│  └────────┬────────┘  └────────┬───────┘  └────────┬───────┘  │
└───────────┼────────────────────┼───────────────────┼──────────┘
            │                    │                   │
            ▼                    ▼                   ▼
┌──────────────────────┐  ┌─────────────────────────────────────┐
│ MCP server           │  │ In-process tool dispatch            │
│ stdio + node fs      │  │ data + mutation + import + csv +    │
│                      │  │ read_file + render handlers         │
└──────────┬───────────┘  └──────────┬──────────────────────────┘
           │                         │
           ▼                         ▼
        ┌──────────────────────────────┐
        │  ToolContext                 │
        │  { repo, fileAdapter, path } │
        └──────────────┬───────────────┘
                       ▼
                   Budget Data
```

Two transport models share a single tool layer:

- **Claude Code adapter** spawns the `claude` CLI as a subprocess and routes all tool calls through the MCP server, which uses node `fs`.
- **API adapters** run the agentic loop in the renderer and dispatch tool calls **in-process**. They use the Tauri `fs` adapter for the same handlers — same `ToolContext` shape, different `FileAdapter` implementation.

The tool handlers don't know which transport called them.

## Session Interface

`CapySession` defines the contract:

- `send(content)` — send user message (`MessageContent`: plain string or array of text / image / document blocks)
- `stop()` — interrupt current response (provider-specific: CLI kills the subprocess; API adapters abort the in-flight request)
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
| `file-attachment` | File name, size, mediaType (rendered as chip) |
| `followups` | Array of `{label, prompt}` follow-up suggestion chips. Click sends `prompt` as next user message. |

A `BlockRenderer` routes each block to its specialized renderer.

### Streaming Behavior

Content blocks are **append-only** in the UI:

- Text blocks: cumulative growth detected by prefix matching — the last text block is updated in-place.
- Non-text blocks (tool activity, tables, charts): always appended.
- After tool results, fresh blocks emit a new sub-message; the handler appends rather than replaces.

Adapters emit `StreamEvent`s directly (`content` / `done` / `error`) — there's no transport-level event layer above this. Text deltas accumulate inside each adapter so every `content` event carries cumulative text, matching what the prefix-detection text-merging downstream expects.

## Adapters

### Claude Code adapter

Spawns `claude` via Tauri's shell plugin in pipe mode with stream-json I/O on both ends. CLI flags supplied at spawn:

- `--session-id <uuid>` — conversation context
- `--mcp-config <path>` — points to MCP server
- `--allowedTools "mcp__capy__*,Read"` — allowlist MCP tools + file reading
- `--add-dir <budget-path>` — grant Read access to the budget folder
- `--setting-sources ""` — skip CLAUDE.md files

Lifecycle: spawn lazily on first message, fresh session ID per spawn, process survives overlay close/reopen, `kill()` ends it. Stop / restart recovery (serialize prior conversation, prepend `[Previous conversation]` on next send) is unique to this adapter — API adapters get a simpler abort-and-continue model.

### Anthropic adapter

Direct `@anthropic-ai/sdk` calls from the renderer. The Tauri webview is a real browser; the SDK runs with `dangerouslyAllowBrowser: true` since the key is the user's own and lives on disk.

The agentic loop owns message history and an `AbortController`. Tool calls dispatch in-process. PDFs ride through the SDK's native `document` content type.

`stop()` aborts the in-flight stream and drops any trailing assistant turn with unmatched `tool_use` blocks (the API would 400 on the next request otherwise).

### OpenAI adapter

Uses `chat.completions.create` with `stream: true` — the stable, broadly-compatible endpoint across the GPT-4 family, GPT-4o, GPT-4.1, GPT-5.

Notable protocol deltas vs Anthropic:

- Tools wrapped as `{ type: "function", function: {...} }`.
- Tool calls stream as deltas keyed by `index`; arguments arrive as a JSON string sliced across many chunks. A per-index accumulator collects fragments; `JSON.parse` runs only after the stream finishes.
- Tool results appended as `{ role: "tool", tool_call_id, content }` messages.
- Images convert to `{ type: "image_url", image_url: { url: "data:..." } }`.
- System prompt is a `{ role: "system" }` message at the head of each request.
- `delta.content` is non-cumulative — accumulated locally before emit.

PDFs aren't supported on `chat.completions`; the import UI gates this upstream (banner: switch to Anthropic or remove the PDF). If a `document` block reaches the converter anyway, it's replaced with an explanatory text block so the model still gets a coherent message.

All three adapters share `buildRenderToolMap()` from `@capybudget/intelligence` for the render-tool → ContentBlock contract. Adding a new render tool means defining it once in `RENDER_TOOL_DEFS` plus its mapping in `render-map.ts`; the three adapters pick it up automatically.

## Tool Layer

Single source of truth shared between transports:

- **Definitions** — tool descriptors (name, description, JSON-Schema input). Both transports consume the same list for ListTools / SDK tool config.
- **Dispatch** — `runTool(name, input, ctx) → string`. The MCP server and the API adapters call this with the same signature. `ToolContext` is `{ repo, fileAdapter, budgetPath }`.
- **Handlers** — per-tool implementations:
  - **Data tools** — `list_accounts`, `list_transactions`, `list_categories`, `spending_summary`, `search_merchants`
  - **Mutation tools** — full CRUD for transactions / accounts / categories plus `assign_categories`
  - **Import tools** — `read_import_file`, `write_import_file`, `append_import_file`, `list_import_files` (over `.capy/import/`)
  - **CSV tools** — `analyze_csv`, `preview_transform`, `transform_csv`, `auto_enrich`, `enrich_stats`, `enrich_sample`, `enrich_update`
  - **read_file** — generic budget-folder text reader; mirrors what Claude CLI's built-in `Read` provides natively
  - **Render tools** — no-op on dispatch (return `"Rendered."`); the frontend intercepts the `tool_use` event and emits the corresponding ContentBlock

All filesystem access goes through the `FileAdapter` on the context, so the same handler runs against node fs (MCP server) and Tauri fs (API adapters in the renderer). The `FileAdapter` interface covers core CSV repo ops (read/write/rename/join) plus the import-handler ops (`mkdir`, `exists`, `readDir`, `appendFile`, `remove`, `stat`).

### Mutation cache invalidation

When the app detects mutation tool activity during a turn, it invalidates the repo's in-memory cache and React Query data on turn completion — so the UI reflects Capy's changes. The set of mutation tool names is exposed for matching.

### Render tools

| Tool | Input | Renders as |
|---|---|---|
| `render_table` | `{ headers, rows }` | Data table with amount coloring |
| `render_bar_chart` | `{ title, data: [{label, value}] }` | Horizontal bar chart |
| `render_donut_chart` | `{ title, data: [{label, value}] }` | SVG donut chart with legend |
| `render_followups` | `{ chips: [{label, prompt}] }` (1–4 items) | Follow-up suggestion chips after an answer. |

No-ops on the dispatch side — they carry structured data from AI to frontend via `tool_use` events.

## MCP Server (External Agents)

The MCP server is a thin transport: it wires the tool definitions to ListTools and `runTool()` to CallTool. Same surface as the in-process API adapters dispatch — Claude Desktop / Cursor / VS Code Copilot users see identical tool behavior.

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

`immediate: true` on the repository — writes flush to disk before returning tool results. SIGTERM/SIGINT call `repo.dispose()` for graceful shutdown.

## Settings

User-facing config persists via `@tauri-apps/plugin-store` (file-based, in the app config directory):

```ts
interface IntelligenceConfig {
  provider: "off" | "claude-cli" | "anthropic" | "openai"
  anthropic: { apiKey: string; model: string }
  openai:    { apiKey: string; model: string }
}
```

The `/settings` route renders a provider radio + per-provider config (API key, model dropdown, custom-model toggle, test-connection button). First-run defaults to `"off"` — users must explicitly pick a provider so they're never surprised by quota usage. Claude Code is still auto-detected via `claude --version` and disabled in the picker if not installed. Pre-Phase-10.5b configs persisted `null` for the disabled state; the store maps `null` → `"off"` on load so the on-disk format stays compatible.

When `provider === "off"`, the Capy overlay shows an empty-state CTA instead of the chat UI.

## Context Enrichment

Each user message is wrapped with app context before sending:

```
[Context]
Budget: personal
Date: March 15, 2026
Budget folder: /path/to/budget

[User message]
What did I spend on food this month?
```

## Custom Instructions

Users can write custom instructions in `capy-instructions.md` in the budget folder. These compose into the system prompt at session start:

```
{SYSTEM_PROMPT}

## User instructions
{contents of capy-instructions.md}
```

User-provided, takes effect on next session.

## Custom Commands

Quick command templates stored as `capy-commands.json` in the budget folder. Three defaults provided (spending breakdown, subscriptions audit, savings rate). Sorted alphabetically.

## System Prompt

Establishes Capy's personality:

- Financial assistant with full CRUD capabilities
- Takes action directly — never tells user to do things in the UI
- Uses render tools for all structured output (tables, charts)
- Defaults to current month when no date range specified
- Concise, direct answers
- Confirms destructive actions before executing

Includes a complete data model description and tool reference so the AI interprets results correctly.

## Import Sessions

Smart Import uses two sequential AI sessions, each with a focused prompt. Both work on every provider.

### Normalize

Takes dropped files, detects format, extracts transactions into a uniform CSV. Leaves enrichment columns empty.

- **Text sources (CSV / OFX / etc.)** are listed by name in the initial message; the agent calls `analyze_csv` → `preview_transform` → `transform_csv` to process them in code.
- **Images and PDFs** ride into the **initial user message as multimodal blocks** — image bytes become `image` content (rendered as `image_url` for OpenAI), PDF bytes become `document` content (Anthropic + Claude CLI only). The agent reads them directly from the message and calls `write_import_file` / `append_import_file` to record extracted rows.

OpenAI doesn't accept PDFs on chat.completions; the import UI gates this with a "switch provider or remove the PDF" banner before the session starts.

### Enrich

Reads the normalized CSV, identifies merchants, matches accounts, and categorizes transactions using a mix of code-driven helpers (`auto_enrich` does fuzzy category and account matching in one pass) and bulk SQL-UPDATE-style calls (`enrich_update`). Runs automatically after normalization; can be re-triggered manually.

The `categoryConfidence` field coordinates between AI and user: enrichment writes `"high"` (merchant history match) or `"low"` (keyword inference), and skips rows where confidence is `"high"` (user-confirmed). The UI shows a confidence dot indicator next to each category.

Both sessions use the same `CapySession` interface and the same tool surface — only the system prompt changes.

## Per-provider Stop / Restart

| | Claude CLI | Anthropic + OpenAI |
|---|---|---|
| `stop()` | kill subprocess + new session ID; serialize prior chat and prepend on next send | abort in-flight request; drop trailing assistant turn with unmatched tool calls; messages otherwise intact |
| `restart()` | kill + new session ID + clear recovery state | abort + clear messages |
| Recovery on next send | `[Previous conversation]` block prepended | continues normally |

The recovery dance is unique to the CLI (it can't reliably resume a session interrupted mid-turn). API adapters get a clean model because `AbortController` doesn't leave them in an ambiguous state.
