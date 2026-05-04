# Intelligence Layer

Capy is an AI financial assistant. The intelligence layer is **provider-pluggable**: the renderer talks to a `CapySession` interface in `@capybudget/intelligence`, and a factory selects one of three concrete adapters at runtime — Claude Code CLI, Anthropic API, or OpenAI API — based on user settings. The app is fully functional without intelligence; it's additive.

> History: the original implementation was hard-wired to Claude Code. The multi-provider refactor landed across Phases A and B (see `INTELLIGENCE_PROVIDERS.md` for the full plan and round-by-round notes). This file documents the current architecture.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Capy Overlay  +  Import Screen              │
│  Messages, input, multimodal attachments     │
└──────────────┬───────────────────────────────┘
               │ CapySession interface
               ▼
┌──────────────────────────────────────────────────────────────┐
│  createIntelligenceSession(config, opts)                     │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ ClaudeCliSession│  │AnthropicSession│  │ OpenAiSession  │  │
│  │ subprocess+MCP  │  │ in-process loop│  │ in-process loop│  │
│  └────────┬────────┘  └────────┬───────┘  └────────┬───────┘  │
└───────────┼────────────────────┼───────────────────┼──────────┘
            │                    │                   │
            ▼                    ▼                   ▼
┌──────────────────────┐  ┌─────────────────────────────────────┐
│ MCP server           │  │ runTool() — in-process dispatch     │
│ (@capybudget/mcp)    │  │ data + mutation + import + csv +    │
│ stdio + node fs      │  │ read_file + render handlers         │
└──────────┬───────────┘  └──────────┬──────────────────────────┘
           │                         │
           ▼                         ▼
        ┌──────────────────────────────┐
        │  ToolContext                 │
        │  { repo, fileAdapter, path } │
        └──────────────┬───────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Budget Data                 │
        │  via @capybudget/persistence │
        └──────────────────────────────┘
```

Two transport models share a single tool layer:

- **Claude Code adapter** spawns the `claude` CLI as a subprocess and routes all tool calls through the MCP server (`@capybudget/mcp`), which uses node `fs`.
- **API adapters** run the agentic loop in the renderer and dispatch tool calls **in-process** via `runTool` from `@capybudget/intelligence/tools/dispatch.ts`. They use the Tauri `fs` adapter for the same handlers — same `ToolContext` shape, different `FileAdapter` implementation.

The tool handlers (data, mutation, import, csv, read_file, render) live in `@capybudget/intelligence/src/tools/handlers/` and don't know which transport called them.

## Session Interface

`CapySession` in `@capybudget/intelligence` defines the contract:

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

`BlockRenderer` routes each block to its specialized renderer.

### Streaming Behavior

Content blocks are **append-only** in the UI:
- Text blocks: cumulative growth detected by prefix matching — the last text block is updated in-place.
- Non-text blocks (tool activity, tables, charts): always appended.
- After tool results, fresh blocks emit a new sub-message; the handler appends rather than replaces.

Adapters emit `StreamEvent`s directly (`content` / `done` / `error`) — there's no transport-level event layer above this. Text deltas are accumulated locally in each adapter so every `content` event carries cumulative text, matching what the prefix-detection text-merging downstream expects. The Claude-CLI adapter also speaks stream-json on the wire, but that's an internal detail of `ClaudeCliSession`; consumers never see the JSON shape.

## Adapters

### Claude Code adapter

Implementation: `packages/app/src/services/claude-cli-session.ts`. Spawns `claude` via Tauri's shell plugin with these flags:

- `-p` — pipe mode
- `--input-format stream-json` / `--output-format stream-json`
- `--session-id <uuid>` — conversation context
- `--mcp-config <path>` — points to MCP server
- `--allowedTools "mcp__capy__*,Read"` — allowlist MCP tools + file reading
- `--add-dir <budget-path>` — grant Read access to the budget folder
- `--setting-sources ""` — skip CLAUDE.md files

Lifecycle: spawn lazily on first message, fresh session ID per spawn, process survives overlay close/reopen, `kill()` ends it. Stop / restart recovery (serialize prior conversation, prepend `[Previous conversation]` on next send) lives inside this class — API adapters get a simpler abort-and-continue model.

### Anthropic adapter

Implementation: `packages/app/src/services/anthropic-session.ts`. Direct `@anthropic-ai/sdk` calls from the renderer (Tauri webview is a real browser; SDK runs with `dangerouslyAllowBrowser: true` since the key is the user's own).

The agentic loop owns message history and an `AbortController`. Tool calls dispatch to `runTool` in-process. PDFs ride through the SDK's native `document` content type.

`stop()` aborts the in-flight `messages.stream()` and drops any trailing assistant turn with unmatched `tool_use` blocks (the API would 400 on the next request otherwise).

### OpenAI adapter

Implementation: `packages/app/src/services/openai-session.ts`. Uses `chat.completions.create` with `stream: true` — the stable, broadly-compatible endpoint across the GPT-4 family, GPT-4o, GPT-4.1, GPT-5.

Notable protocol deltas vs Anthropic, handled inline:
- Tools wrapped as `{ type: "function", function: {...} }`
- Tool calls stream as deltas keyed by `index`; arguments arrive as a JSON string sliced across many chunks. A per-index accumulator collects fragments; `JSON.parse` only after the stream finishes.
- Tool results appended as `{ role: "tool", tool_call_id, content }` messages.
- Images convert to `{ type: "image_url", image_url: { url: "data:..." } }`.
- System prompt is a `{ role: "system" }` message at the head of each request.
- `delta.content` is non-cumulative — accumulated locally before emit.

PDFs aren't supported on chat.completions; the import UI gates this upstream (banner: switch to Anthropic or remove the PDF). If a `document` block reaches `toOpenAiUserContent` anyway, it's replaced with an explanatory text block so the model still gets a coherent message.

## Tool Layer

Single source of truth at `@capybudget/intelligence/src/tools/`:

- `definitions.ts` — tool descriptors (name, description, JSON-Schema input). Both transports consume `getToolDefinitions()` for ListTools / SDK tool config.
- `dispatch.ts` — `runTool(name, input, ctx) → string`. The MCP server and the API adapters call this with the same signature. `ToolContext` is `{ repo, fileAdapter, budgetPath }`.
- `handlers/` — per-tool implementations:
  - `data.ts` — `list_accounts`, `list_transactions`, `list_categories`, `spending_summary`, `search_merchants`
  - `mutation.ts` — full CRUD for transactions / accounts / categories plus `assign_categories`
  - `import.ts` — `read_import_file`, `write_import_file`, `append_import_file`, `list_import_files` (over `.capy/import/`)
  - `csv.ts` — `analyze_csv`, `preview_transform`, `transform_csv`, `auto_enrich`, `enrich_stats`, `enrich_sample`, `enrich_update`
  - `read-file.ts` — `read_file` (generic budget-folder text reader; mirrors what Claude CLI's built-in `Read` provides natively)
  - render is a no-op on dispatch — render tools (`render_*`) return `"Rendered."` and the frontend intercepts the `tool_use` event before dispatch sees it.

All filesystem access goes through the `FileAdapter` on the context, so the same handler runs against node fs (MCP server) and Tauri fs (API adapters in the renderer).

The `FileAdapter` interface (`@capybudget/persistence`) covers core CSV repo ops (read/write/rename/join) plus the import-handler ops (`mkdir`, `exists`, `readDir`, `appendFile`, `remove`, `stat`).

### Mutation cache invalidation

When the app detects mutation tool activity during a turn, it invalidates the repo's in-memory cache and React Query data on turn completion — so the UI reflects Claude's changes. `MUTATION_TOOL_NAMES` exposes the set of names to watch.

### Render tools

| Tool | Input | Renders as |
|---|---|---|
| `render_table` | `{ headers, rows }` | Data table with amount coloring |
| `render_bar_chart` | `{ title, data: [{label, value}] }` | Horizontal bar chart |
| `render_donut_chart` | `{ title, data: [{label, value}] }` | SVG donut chart with legend |

No-ops on the dispatch side — they carry structured data from AI to frontend via `tool_use` events.

## MCP Server (External Agents)

`@capybudget/mcp` is a thin transport: it wires `getToolDefinitions()` to ListTools and `runTool()` to CallTool. Same surface as the in-process API adapters dispatch — Claude Desktop / Cursor / VS Code Copilot users see identical tool behavior.

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

User-facing config persists via `@tauri-apps/plugin-store` (file-based, `appConfigDir`):

```ts
interface IntelligenceConfig {
  provider: "claude-cli" | "anthropic" | "openai" | null
  anthropic: { apiKey: string; model: string }
  openai:    { apiKey: string; model: string }
}
```

The `/settings` route renders a provider radio + per-provider config (API key, model dropdown, custom-model toggle, test-connection button). Claude Code is auto-detected via `claude --version` and disabled if not installed.

When `provider == null`, the Capy overlay shows an empty-state CTA instead of the chat UI.

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

Users can write custom instructions in `capy-instructions.md` in the budget folder. These are composed into the system prompt at session start:

```
{SYSTEM_PROMPT}

## User instructions
{contents of capy-instructions.md}
```

User-provided, takes effect on next session.

## Custom Commands

Quick command templates stored as `capy-commands.json` in the budget folder. 3 defaults provided (spending breakdown, subscriptions audit, savings rate). Sorted alphabetically.

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

Smart Import uses two sequential AI sessions, each with a focused prompt. Both work on every provider after Phase B.

### Normalize (`IMPORT_SYSTEM_PROMPT`)

Takes dropped files, detects format, extracts transactions into a uniform CSV. Leaves enrichment columns empty.

- **Text sources (CSV / OFX / etc.)** are listed by name in the initial message; the agent calls `analyze_csv` → `preview_transform` → `transform_csv` to process them in code.
- **Images and PDFs** ride into the **initial user message as multimodal blocks** — image bytes become `image` content (rendered as `image_url` for OpenAI), PDF bytes become `document` content (Anthropic + Claude CLI only). The agent reads them directly from the message and calls `write_import_file` / `append_import_file` to record extracted rows. No Read-tool round-trip — that path was Claude-CLI-only and didn't translate cleanly to the API adapters' tool-result shapes.

OpenAI doesn't accept PDFs on `chat.completions`; the import UI gates this with a "switch provider or remove the PDF" banner before the session starts.

### Enrich (`ENRICH_SYSTEM_PROMPT`)

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
