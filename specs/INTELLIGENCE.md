# Intelligence Layer

Capy is an AI financial assistant. The intelligence layer is **provider-pluggable**: the renderer talks to a `CapySession` interface, and a factory selects one of four concrete adapters at runtime — Claude Code CLI, Anthropic API, OpenAI API, or Ollama — based on user settings. The app is fully functional without intelligence; it's additive.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Capy Overlay                                │
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
│ stdio + node fs      │  │ data + mutation + start_import +    │
│                      │  │ read_file + read_spec + render      │
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

Smart Import does not run through the agent loop. It's a code-orchestrated pipeline (see `IMPORT.md`) that calls the model statelessly through the `structured()` primitive — no tools, no accumulated context. The chat surface's only connection to import is the `start_import` tool: the chat on-ramp that stages an attachment and hands it to that pipeline.

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
| `content` | Full cumulative blocks array for the current user→done cycle (entire agentic loop, across iterations and tool calls). Consumer replaces the trailing assistant message's blocks wholesale on every emit. |
| `tool-result` | A tool call finished executing. Carries the tool name, the adapter-specific call id, and an `ok` flag. Used by the hook to invalidate caches live, per-call, instead of waiting for `done`. Distinct from the `tool-activity` ContentBlock, which signals the call was *requested*. |
| `done` | Cycle complete |
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

Every `content` event carries the **complete cumulative blocks array** for the current user→done cycle — the entire agentic loop, across iterations and tool calls. The consumer (`mergeStreamContent`) replaces the trailing assistant message's blocks wholesale on every tick. Adapters are responsible for accumulating across model turns so non-text blocks (charts, tables, follow-up pills) survive subsequent turns.

Adapter accumulation:

- Anthropic + OpenAI adapters: a `completedBlocks` array lives outside the agentic loop. Each iteration appends a fresh text block (driven by streamed text deltas) and pushes any tool-use blocks (rendered or `tool-activity`). The array survives across tool-result rounds.
- Claude Code adapter: the CLI emits one `assistant` event per content block, all sharing the message's `id` (the id persists even across in-turn tool boundaries). The decoder is stateless and forwards `message.id` as the optional `messageId` on `StreamEvent.content`; `CycleAccumulator` stitches events into one cumulative array — appending same-id text blocks as distinct blocks (replacing in place only when the incoming text extends the in-progress one, the cumulative-snapshot shape older CLIs streamed), promoting blocks into a finished-turns buffer when `messageId` changes, and dropping text for the rest of the cycle once a rendered followups block lands (see the terminal-signal tool).

Adapters emit `StreamEvent`s directly (`content` / `tool-result` / `done` / `error`) — there's no transport-level event layer above this.

Adapters surface `done` off the model's terminal event (Anthropic `message` / OpenAI `finish_reason`) and abort the transport early rather than waiting for SSE drain — gating on the transport adds seconds of post-content latency. The Claude CLI populates no `stop_reason` on assistant events; its `done` rides the trailing `result` line. The parser still emits `done` early off a terminal `stop_reason` should one appear, with the `result` line as the guaranteed emitter so the UI never hangs.

## Structured Output

Alongside the agentic `CapySession`, the in-process API adapters expose a second, stateless primitive: `StructuredSession.structured(messages, schema, options?) → T`. One constrained model call returns a value the caller's JSON Schema describes — no agent loop, no tools, no accumulated context. An optional `onText` callback switches the call to a streaming request and surfaces the accumulated raw response text per delta — a partial JSON prefix the caller can derive live progress from; the resolved value is identical either way. Smart Import is built on this; the agent loop is for chat.

Both providers constrain generation to the schema server-side (Anthropic `output_config.format`, OpenAI `response_format` json_schema). `parseStructured` is the client-side enforcement layer: it parses the returned text and validates it against the same schema, so a malformed or off-schema response throws (`SchemaValidationError`) at the call site rather than landing as a silently-wrong object downstream. User turns may carry multimodal content (receipt images, PDF bytes); assistant turns are text-only, because the API rejects image/document blocks in an assistant turn.

The Anthropic and OpenAI adapters implement both `CapySession` and `StructuredSession`. The Claude Code CLI adapter implements only `CapySession` — its structured-call path is not available, which is why import is gated to the API providers (see **Settings** and `IMPORT.md`).

## Adapters

### Claude Code adapter

Spawns `claude` via Tauri's shell plugin in pipe mode with stream-json I/O on both ends. CLI flags supplied at spawn:

- `--session-id <uuid>` — conversation context
- `--mcp-config <path>` — points to MCP server
- `--allowedTools "mcp__capy__*,Read"` — allowlist MCP tools + file reading
- `--disallowedTools "TodoWrite,Task,Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch,NotebookEdit,KillBash,BashOutput"` — explicitly block the CLI's stock built-ins. Even when omitted from the allowlist the model still knows they exist and the CLI's baked-in system prompt nudges it to deliberate about them ("should I use TodoWrite for this?") — disallowing silences that meta-narration.
- `--add-dir <budget-path>` — grant Read access to the budget folder
- `--setting-sources ""` — skip CLAUDE.md files
- env `ENABLE_TOOL_SEARCH=false` — disables the CLI's deferred MCP tool loading (undocumented knob) so every `mcp__capy__*` schema loads upfront. With deferral on, the model must fetch schemas via ToolSearch mid-turn and sometimes calls render tools blind with invented payloads.

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
- PDFs convert to a `{ type: "file", file: { filename, file_data: "data:application/pdf;base64,..." } }` content part — `chat.completions` reads PDFs on vision-capable models. The `filename` is required alongside inline `file_data`; the adapter falls back to `document.pdf` when a block carries none.
- System prompt is a `{ role: "system" }` message at the head of each request.
- `delta.content` is non-cumulative — accumulated locally before emit.

Callers attach PDF blocks uniformly across providers; the adapter maps the shared `document` block to each provider's content type (Anthropic's native `document`, OpenAI's `file`).

### Ollama adapter

A subclass of the OpenAI adapter, not a second client. Ollama serves an OpenAI-compatible API under `/v1` — same chat-completions shape, same streamed tool-call deltas, same `response_format: json_schema` — so the adapter is `OpenAiSession` with `baseURL` pointed at the local server (`http://localhost:11434/v1` by default) and a placeholder API key, since a local server authenticates nothing. Only the provider tag on error events is overridden, so billing CTAs and copy route correctly.

Two honest differences, both handled outside the class:

- **No documents.** The compatibility shim has no `file` content part, so `canReadPdf("ollama")` is false and callers never build a `document` block for it. Statements go in as CSV/OFX.
- **`max_completion_tokens` is not an Ollama parameter.** It rides along in the request and is ignored, leaving generation uncapped — acceptable for a local model where the cost is wall-clock, not tokens.

Whether a given model can call tools or honor a JSON schema is the model's business, not the adapter's; Settings steers users toward tool-capable ones. Because there is no key, Ollama never touches the OS keychain: its entire config (endpoint + model) lives in the plaintext store file.

All adapters share `buildRenderToolMap()` from `@capybudget/intelligence` for the render-tool → ContentBlock contract. Adding a new render tool means defining it once in `RENDER_TOOL_DEFS` plus its mapping in `render-map.ts`; every adapter picks it up automatically.

## Tool Layer

Single source of truth shared between transports:

- **Definitions** — tool descriptors (name, description, JSON-Schema input). `getToolDefinitions()` is the single source: no argument, one surface. The MCP server, the in-process chat agent loop, and external agents all see the same set. The structured import session calls the model with no tools, so it never draws from here.
- **Dispatch** — `runTool(name, input, ctx) → string`. The MCP server and the API adapters call this with the same signature. `ToolContext` is `{ repo, fileAdapter, budgetPath, attachments?, importSupported?, pdfSupported? }` — the last three ride only the chat path, for `start_import`.
- **Handlers** — per-tool implementations:
  - **Data tools** — `list_accounts`, `list_transactions` (filters + `sort` + `offset` + `format: "compact" | "full"`, plus `ids` to fetch exact rows after a scan), `search_transactions` (fuzzy cross-field + money query and structured filters → compact rows), `group_transactions` (the universal aggregator: same filters as search, then `groupBy` one or more dimensions — merchant/category/account/type/month/week/dayOfMonth/amountBucket — and request `metrics` over signed cents, including per-group `cadence` for recurrence; subsumes spending-by-category, merchant rollups, duplicate clusters, and interval analysis), `list_categories`
  - **Mutation tools** — full CRUD for transactions / accounts / categories, plus `bulk_update_transactions` (category/account/date/merchant across many rows; skips transfers for category/account/merchant). `update_account` carries `archived` (archiving fails on a non-zero balance) and `excludeFromNetWorth`. `update_category` carries `archived` and `budgetCents` (the explicit `assigned` budget — `null` untracked, `0` tracked-at-zero, omitted unchanged; a category without one still has an implicit target derived from its spending history).
  - **start_import** — the chat on-ramp into Smart Import. Takes no arguments: it stages the files attached to the in-flight chat turn into `.capy/import/sources/` and marks the run so the Import screen auto-starts the orchestrator. Capy calls this for any uploaded file instead of reading it and creating transactions itself. See **Import On-Ramp** below.
  - **read_file** — generic budget-folder text reader; mirrors what Claude CLI's built-in `Read` provides natively
  - **read_spec** — reads one of the app's design docs (`specs/*.md`). Content is bundled at build time into `specs.generated.ts` — no filesystem access, no path resolution surface. Use when capy needs implementation detail beyond what the system prompt already embeds.
  - **Render tools** — dispatch validates the payload against the render-map builders: valid calls return `"Rendered."`, malformed or empty-data input returns an error result. The frontend intercepts the `tool_use` event and emits the corresponding ContentBlock. See **Render tools** below.

All filesystem access goes through the `FileAdapter` on the context, so the same handler runs against node fs (MCP server) and Tauri fs (API adapters in the renderer). The `FileAdapter` interface covers core CSV repo ops (read/write/rename/join) plus the staging-handler ops (`mkdir`, `exists`, `readDir`, `appendFile`, `remove`, `stat`) the import pipeline and `start_import` use.

### Prompt caching

The tools + system prefix is static across a session, so the API adapters cache it instead of re-billing ~7-8K tokens of schema every turn of a multi-turn loop. All per-turn content (the context wrapper, budget snapshot, attachments — see **Context Enrichment**) rides in the user messages, after the prefix, so the prefix stays identical turn-to-turn.

- **Anthropic** marks the system block with `cache_control: { type: "ephemeral" }`. One breakpoint at the end of system caches everything before it in the prefix hierarchy — tools, then system. Cache hits show up as `cache_read_input_tokens` in usage from turn 2 on.
- **OpenAI** caches eligible prefixes (>~1024 tokens) automatically, no flag — the adapter's job is to keep the prefix byte-stable: the system message is immutable for the session and leads every request, tools follow the same definition order, dynamic content never bakes into either.

This is in-process-adapter only; the Claude CLI manages its own caching.

### Mutation cache invalidation

The app invalidates caches per mutation tool call (not per turn) so the UI reflects Capy's changes live as it works. `MUTATION_TOOL_NAMES` is exposed for matching.

### Render tools

| Tool | Input | Renders as |
|---|---|---|
| `render_table` | `{ headers, rows }` | Data table with amount coloring |
| `render_chart` | `{ title, type: "bar" \| "donut", data: [{label, value}] }` | Horizontal bar chart or SVG donut chart with legend, per `type` |
| `render_followups` | `{ chips: [{label, prompt}] }` (1–4 items) | Follow-up suggestion chips after an answer. |

Dispatch validates the payload with the same rules the frontend renderer applies — malformed or empty-data input returns an error result so the model corrects itself and retries. Valid calls are otherwise no-ops on the dispatch side; they carry structured data from AI to frontend via `tool_use` events.

`render_followups` is a **terminal-signal tool**: when the model calls it successfully, the assistant turn is over. The API adapters dispatch the call (so the UI gets the chips) and push the tool_result to history, then exit the agentic loop without making another request. A followups call that fails validation is not terminal — the loop continues so the model sees the error result and recovers. Skipping the ack round-trip saves a full stream per turn. The Claude CLI runs the loop in-subprocess; the prompt tells the model to stay silent after calling `render_followups`, and the accumulator drops any text it still emits for the rest of the cycle. The drop latch arms only on a successfully rendered followups block — after a failed render the model's recovery text still shows.

## MCP Server (External Agents)

The MCP server is a thin transport: it wires the tool definitions to ListTools and `runTool()` to CallTool. It exposes `getToolDefinitions()` — the one shared surface — to external agents (Claude Desktop / Cursor / VS Code Copilot). The in-process chat agent loop sees the same surface; dispatch behavior is identical across both. (`start_import` is a no-op from MCP — it needs the chat turn's attachments, which an external agent's call doesn't carry, so it returns guidance rather than staging.)

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
  provider: "claude-cli" | "anthropic" | "openai" | "ollama" | null
  anthropic: { apiKey: string; model: string; keyPresent?: boolean }
  openai:    { apiKey: string; model: string; keyPresent?: boolean }
  ollama:    { baseUrl: string; model: string } // no key: a local server authenticates nothing
  claudeCli: { model: string } // "" lets the CLI pick its default
}
```

The provider **API keys are the exception** — they never rest in the plaintext
store file. Each key is a generic-password entry in the OS credential store
(macOS Keychain / Windows Credential Manager / Linux secret-service) under the
app bundle id.

**The keychain is never touched at boot.** Hydrate reads the plaintext file
only — provider, models, and per-provider `keyPresent` flags — so the first
render pops no OS credential prompt. `keyPresent` is the boot-time truth (a key
is configured), known without reading its value; UI gating (`isConfigured`,
`importReady`) reads presence, so `apiKey` stays `""` until it's actually
needed. The value loads **on demand** — the first time it's used (Capy opened
with an API provider, an import run started, Settings rendering a key's last-4)
— through a single keychain read that merges both provider secrets into the
in-memory config and persists the resolved flags. Provider `claude-cli` or off
never triggers a read, so those sessions touch the keychain zero times.

The **first-ever** keychain read of an install is gated behind a one-time
heads-up (a small dialog in Capy's visual language, "Allow" its only action),
so the OS prompt lands in a context the user triggered; a persisted `gateSeen`
flag suppresses it thereafter and later sessions load silently on demand.
Dismissing it simply doesn't load yet — no cancel-path state.

The heads-up shows only **once per install**, which fully tames the surprise
prompt only where the OS prompt is one-time too. On the MAS (data-protection)
path there's no OS dialog at all. On a Developer ID / DMG build the entries sit
in the legacy keychain, whose ACL is bound to the exact code signature, so macOS
re-prompts after each app update — the heads-up, already seen, doesn't reappear
to reframe those later prompts. A denied read is recoverable: it surfaces a
retryable error rather than latching the key as absent (see `secretsError`).

A config written before this split keeps keys inline; the first on-demand load
migrates them into the keychain — keychain write first, so an interrupted run
never drops a key — then strips the file. For a config written before
`keyPresent` existed, presence at boot is inferred (an inline key, or the
selected provider assumed likely to have one) and the first load resolves the
truth. Where no credential store is usable (Linux without a running
secret-service; dev builds, which stay on the store file to dodge the recurring
keychain prompts an unstable ad-hoc signature causes — set `VITE_CAPY_KEYCHAIN=1`
to opt a dev build back into the keychain), keys persist inline in the store
file, with the same deferred-load surface. See `src-tauri/src/keychain.rs` and
`stores/secret-config.ts`.

Settings lives in the `/budget` Intelligence section. It renders a provider radio + per-provider config (API key where applicable, model picker, test-connection button). The radio order is **Off / Anthropic API / OpenAI API / Ollama / Claude Code**; Ollama carries a `local` badge and sits below the hosted APIs (it needs a server the user installs themselves); Claude Code carries an `advanced` badge and sits last as the source-build option — the Mac App Store build omits it entirely, since the App Sandbox forbids the subprocess spawning it relies on. First-run defaults to `null` — users must explicitly pick a provider so they're never surprised by quota usage. The radio's "Off" label maps to `null` at the form boundary. Claude Code is auto-detected via `claude --version` and disabled in the picker if not installed.

Every provider uses one shared model picker: a curated dropdown plus a "Use a custom model" toggle that swaps in a free-text field for any model ID outside the list. A saved model not in the curated list opens the field in custom mode, so a user's pinned model survives a refreshed list. The curated options:

- **Anthropic** — Claude Opus 4.8 (`claude-opus-4-8`), Claude Sonnet 5 (`claude-sonnet-5`, the default), Claude Haiku 4.5 (`claude-haiku-4-5`).
- **OpenAI** — GPT-5.5 (`gpt-5.5`, the default), GPT-5.4 mini (`gpt-5.4-mini`), GPT-5.4 nano (`gpt-5.4-nano`).
- **Ollama** — *discovered, not curated*: the dropdown lists what `/v1/models` reports the local server has pulled, since only the user's machine knows. A previously-saved model that is no longer pulled stays in the list so the choice is never silently rewritten. There is no default — an empty model is the "not configured" state, the same gate an empty API key is elsewhere. The block also exposes the server URL (blur-committed, an empty field snapping back to the stock endpoint) and re-probes on every URL change.
- **Claude Code** — Default (empty, the CLI decides), plus the `fable` / `opus` / `sonnet` / `haiku` aliases. A non-empty value passes through as the CLI's `--model` flag at spawn; empty omits the flag.

When `provider === null`, the Capy overlay shows an empty-state CTA instead of the chat UI.

Smart Import needs the structured-output primitive, which the Anthropic, OpenAI, and Ollama adapters implement. `canImport(provider)` is the single gate — true for `anthropic`, `openai`, and `ollama`, false for `claude-cli` and `null`. `importReady(config)` adds the "configured enough to run" check: a key for the API providers, a chosen model for Ollama. The Import tab shows an offline CTA when it's false, and the chat `start_import` tool returns switch-provider guidance.

The Intelligence section also hosts a chat-instructions editor for `capy-instructions.md` (see Custom Instructions). The same file is editable from the Capy overlay; edits apply to the next conversation. The web demo can't store an AI provider, so it renders the provider list disabled behind a desktop-only notice and omits the per-provider config and the chat-instructions editor; Categories management stays fully functional.

## Context Enrichment

Each user message is wrapped with app context before sending. The first message of a session also carries a compact **budget snapshot** — the budget's currency, account and transaction counts, the date range, the category list, and (only when present) the foreign-currency accounts — so Capy knows the shape of the data (and the currency to format in) without a tool round-trip.

```
[Context]
Budget: personal
Date: March 15, 2026
Budget folder: /path/to/budget

[Budget snapshot]
Currency: EUR
Accounts: 4 active
Transactions: 1820 (2020-01-03 → 2026-03-14)
Foreign-currency accounts:
  Tinkoff: RUB
Aggregate totals (group_transactions, list_accounts balances) are in the default currency (EUR); per-row amounts in list_transactions are each account's own currency.
Categories:
  Income: Paycheck, Other Income
  Fixed: Housing, Bills & Utilities, Subscriptions
  Daily Living: Groceries, Dining Out, Transportation
  ...

[User message]
What did I spend on food this month?
```

The foreign-account block and its roll-up note appear only once an account holds a non-default currency; a single-currency budget's snapshot is unchanged.

The budget's currency is display-only (money stays integer minor units everywhere — see `DATA_MODEL.md`). Only the currency code reaches the model — the user's UI format overrides (decimals, symbol position) stay in the app and never thread into Capy. It threads three ways: into the snapshot above, into the chat system prompt's money examples, and into the `ToolContext` (so money in tool results is rendered correctly). Aggregate roll-ups are converted into the budget default: `list_accounts` balances and every `group_transactions` total. Per-row amounts in `list_transactions` are rendered in **each account's own currency** — the native truth of the row — since totals are the aggregator's job, not the row list's. Each currency uses its own default convention, not the user's overrides. The tool handlers receive currency on the context, not from the repository, which exposes only entities.

## Custom Instructions

Users can write custom instructions for the chat assistant in `capy-instructions.md` in the budget folder, edited from either the Capy overlay dialog or the Settings ▸ Intelligence editor — both write the same file. These compose into the chat system prompt at session start:

```
{SYSTEM_PROMPT}

## User instructions
{contents of capy-instructions.md}
```

Import sessions read a separate `import-instructions.md` from the same folder — the chat-tuning instructions ("answer in fewer words", "always show charts") rarely overlap with import-tuning instructions ("treat ATM withdrawals as transfers to cash"), so the two surfaces are kept distinct. Each file is user-provided and takes effect on the next session of its respective surface.

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

The chat prompt opens with a shared **app-knowledge brief** (`specs/APP_KNOWLEDGE.md`, factored through `prompts/app-knowledge.ts`) — the transaction log, accounts, categories, derived budgets, the analytics surface, who the user is, and what Capy's job is. It's a tight, purpose-built doc, not a spec dump: ~1.3K tokens of always-on common ground rather than the full schema and feature inventory.

The brief is sourced from `packages/intelligence/src/specs.generated.ts`, regenerated on every build by `scripts/generate-specs.ts`. For detail beyond the brief — the exact CSV schemas in `DATA_MODEL.md`, the full feature inventory in `PRODUCT.md`, the architecture, the import pipeline, the intelligence layer itself — capy calls `read_spec`.

## Import Sessions

Smart Import is a code-orchestrated pipeline (`IMPORT.md`), not an agent session. It calls the model through `structured()` at two points, each a single constrained call with no tools and no accumulated context:

- **Mapping / extraction** (Normalizing) — a CSV's headers + samples become a `CsvMapping`; an image or PDF's bytes become the same intermediate transaction records directly. Receipt images ride as base64 `image` content, PDFs as base64 `document` content, on the user turn the structured call sends.
- **Categorizing** — batches of ~25 rows, each carrying its distilled history context and the category list, return `{ id, merchant, categoryId, confidence }[]`. Batches are bounded-parallel and fail in isolation.

All these calls share one short import system prompt (`import/system-prompt.ts`): it sets the role and two invariants — extract only what the source contains, and answer with the requested structure — while each call's task and schema ride in the request itself. The per-run hints and `import-instructions.md` from the Import tab compose onto this prompt. There is no per-call tool surface, no agent loop, and no `categoryConfidence` REPL between AI and tools; confidence is just a field each Categorizing row returns (`high` / `low`), which the preview renders as a dot.

## Session Tool-Call Budget

Every `CapySession` enforces a per-session cap of **100 tool calls** as a runaway-loop backstop. When exceeded, the session emits a `StreamEvent.error` describing the budget exhaustion and terminates that turn cleanly. The user sees the error and can run again; the budget resets per session.

This is a hard backstop on the chat agent loop, not the normal path. A well-formed answer converges in a handful of calls. The cap exists to bound the failure mode when something goes wrong. (Smart Import is not an agent loop — its stateless `structured()` calls make no tool calls and don't draw on this budget.)

Enforcement varies by adapter:

- **Anthropic / OpenAI / Ollama** count tool calls inline as they dispatch them. When the cap trips mid-turn, remaining tool_use blocks in the same turn receive a budget-exhausted error result (so the API doesn't see dangling tool_use) and the agentic loop exits without making the next request.
- **Claude CLI** parses each assistant event, dedups tool_use IDs into a Set, and kills the subprocess + surfaces the error event when the Set grows past the cap. The CLI can't be told to stop from outside, so termination is the cleanest signal we can give.

## Per-provider Stop / Restart

| | Claude CLI | Anthropic + OpenAI + Ollama |
|---|---|---|
| `stop()` | kill subprocess + new session ID; serialize prior chat and prepend on next send | abort in-flight request; drop trailing assistant turn with unmatched tool calls; messages otherwise intact |
| `restart()` | kill + new session ID + clear recovery state | abort + clear messages |
| Recovery on next send | `[Previous conversation]` block prepended | continues normally |

The recovery dance is unique to the CLI (it can't reliably resume a session interrupted mid-turn). API adapters get a clean model because `AbortController` doesn't leave them in an ambiguous state.
