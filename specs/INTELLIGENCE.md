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
| `status` | One import progress line, from `report_status`. The import store intercepts it to drive the status line/log (see **Status channel**). |
| `file-attachment` | File name, size, mediaType (rendered as chip) |
| `followups` | Array of `{label, prompt}` follow-up suggestion chips. Click sends `prompt` as next user message. |

A `BlockRenderer` routes each block to its specialized renderer.

### Streaming Behavior

Every `content` event carries the **complete cumulative blocks array** for the current user→done cycle — the entire agentic loop, across iterations and tool calls. The consumer (`mergeStreamContent`) replaces the trailing assistant message's blocks wholesale on every tick. Adapters are responsible for accumulating across model turns so non-text blocks (charts, tables, follow-up pills) survive subsequent turns.

Adapter accumulation:

- Anthropic + OpenAI adapters: a `completedBlocks` array lives outside the agentic loop. Each iteration appends a fresh text block (driven by streamed text deltas) and pushes any tool-use blocks (rendered or `tool-activity`). The array survives across tool-result rounds.
- Claude Code adapter: the CLI emits each model turn's `assistant` event as a per-turn snapshot. The decoder is stateless and forwards `message.id` as the optional `messageId` on `StreamEvent.content`; the session stitches turns into one cumulative array, promoting blocks into a finished-turns buffer when `messageId` changes.

Adapters emit `StreamEvent`s directly (`content` / `tool-result` / `done` / `error`) — there's no transport-level event layer above this.

Adapters surface `done` off the model's terminal event (Anthropic `message` / OpenAI `finish_reason` / CLI assistant `stop_reason`) and abort the transport early rather than waiting for SSE or subprocess drain — gating on the transport adds seconds of post-content latency. The Claude CLI parser keeps the trailing `result` line as a safety-net `done` emitter for the case where no `stop_reason` arrives, so the UI never hangs.

## Adapters

### Claude Code adapter

Spawns `claude` via Tauri's shell plugin in pipe mode with stream-json I/O on both ends. CLI flags supplied at spawn:

- `--session-id <uuid>` — conversation context
- `--mcp-config <path>` — points to MCP server
- `--allowedTools "mcp__capy__*,Read"` — allowlist MCP tools + file reading
- `--disallowedTools "TodoWrite,Task,Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch,NotebookEdit,KillBash,BashOutput"` — explicitly block the CLI's stock built-ins. Even when omitted from the allowlist the model still knows they exist and the CLI's baked-in system prompt nudges it to deliberate about them ("should I use TodoWrite for this?") — disallowing silences that meta-narration.
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

PDFs aren't supported on `chat.completions`. The adapter drops any `document` block and substitutes an explanatory text note describing what happened, so the model can respond coherently (e.g. ask the user to paste contents or share a screenshot). Callers attach PDF blocks uniformly across providers; provider divergence is the adapter's responsibility.

All three adapters share `buildRenderToolMap()` from `@capybudget/intelligence` for the render-tool → ContentBlock contract. Adding a new render tool means defining it once in `RENDER_TOOL_DEFS` plus its mapping in `render-map.ts`; the three adapters pick it up automatically.

## Tool Layer

Single source of truth shared between transports:

- **Definitions** — tool descriptors (name, description, JSON-Schema input), 29 in all. `getToolDefinitions(mode?)` is the single source: no argument returns the full surface (what the MCP server exposes); a `mode` (`"chat"` | `"import"`) filters to that mode's tools (see **Mode gating** below).
- **Dispatch** — `runTool(name, input, ctx) → string`. The MCP server and the API adapters call this with the same signature. `ToolContext` is `{ repo, fileAdapter, budgetPath }`.
- **Handlers** — per-tool implementations:
  - **Data tools** — `list_accounts`, `list_transactions` (filters + `sort` + `offset` + `format: "compact" | "full"`, plus `ids` to fetch exact rows after a scan), `search_transactions` (fuzzy cross-field + money query and structured filters → compact rows), `group_transactions` (the universal aggregator: same filters as search, then `groupBy` one or more dimensions — merchant/category/account/type/month/week/dayOfMonth/amountBucket — and request `metrics` over signed cents, including per-group `cadence` for recurrence; subsumes spending-by-category, merchant rollups, duplicate clusters, and interval analysis), `list_categories`
  - **Mutation tools** — full CRUD for transactions / accounts / categories, plus `bulk_update_transactions` (category/account/date/merchant across many rows; skips transfers for category/account/merchant). `update_account` carries `archived` (archiving fails on a non-zero balance) and `excludeFromNetWorth`. `update_category` carries `archived` and `budgetCents` (the explicit `assigned` budget — `null` untracked, `0` tracked-at-zero, omitted unchanged; a category without one still has an implicit target derived from its spending history).
  - **Import tools** — `read_import_file`, `write_import_file` (carries `mode: "overwrite" | "append"`, default overwrite), `list_import_files` (over `.capy/import/`)
  - **CSV tools** — `analyze_csv`, `preview_transform`, `transform_csv`, `auto_enrich`, `apply_account_aliases`, `enrich_status` (stats; `sampleSize > 0` also returns sample rows), `enrich_update`, `find_duplicates` (candidates grouped by confidence, each with the matched original's merchant/category), `mark_duplicates` (persist dup flags + dup-enrich), `auto_mark_duplicates` (code-triggered high-confidence pass)
  - **read_file** — generic budget-folder text reader; mirrors what Claude CLI's built-in `Read` provides natively
  - **read_spec** — reads one of the app's design docs (`specs/*.md`). Content is bundled at build time into `specs.generated.ts` — no filesystem access, no path resolution surface. Use when capy needs implementation detail beyond what the system prompt already embeds.
  - **Render tools** — no-op on dispatch (return `"Rendered."`); the frontend intercepts the `tool_use` event and emits the corresponding ContentBlock

All filesystem access goes through the `FileAdapter` on the context, so the same handler runs against node fs (MCP server) and Tauri fs (API adapters in the renderer). The `FileAdapter` interface covers core CSV repo ops (read/write/rename/join) plus the import-handler ops (`mkdir`, `exists`, `readDir`, `appendFile`, `remove`, `stat`).

### Mode gating

An in-process API session sees only the tools its system prompt can use, so a chat asking "what did I spend on coffee" isn't handed the CSV/enrich pipeline (and doesn't pay to re-send those schemas every turn). The factory threads a `mode` into the API adapters, which pass it to `getToolDefinitions(mode)`:

- **chat** (22 tools) — reads, full CRUD, render tools, `read_file`/`read_spec`, plus `search_transactions` (fuzzy "find all my Apple charges" → compact rows; the prompt also reaches for it on "how much did I spend at X?"), `group_transactions` (spending breakdowns, rollups, recurrence — the prompt steers all aggregation here rather than hand-summing rows), and read-only import visibility (`read_import_file` / `list_import_files`) for staged-import questions. No CSV/enrich/write tools.
- **import** (14 tools) — the CSV transform + enrich pipeline (`analyze_csv`/`preview_transform`/`transform_csv`/`enrich_status`/`enrich_update`), the dedup pair (`find_duplicates`/`mark_duplicates`), `write_import_file`, `report_status` (the run's sole communication channel — see **Status channel**), `search_transactions` (look up a cryptic description in budget history and inherit the matching rows' merchant + category), `list_accounts`/`list_categories` (transfer-target and category UUIDs), and `read_file`/`read_spec`. The staged-file readers (`read_import_file`/`list_import_files`) are **not** advertised here — the import session writes its own files and tracks them in the run, so it doesn't inspect the directory; they stay chat-only and on the MCP surface. The single import run advertises this union across every phase. No render or live-budget mutation tools.

`auto_enrich`, `apply_account_aliases`, and `auto_mark_duplicates` are **code-triggered, never advertised**: none has a `TOOL_MODES` entry, so no model sees them, but they stay on the MCP surface and dispatchable via `runTool` — the import orchestrator runs each as a deterministic phase pre-step (`apply_account_aliases` before the accounts turn, `auto_mark_duplicates` before the dedup turn, `auto_enrich` before the enrich turn). Dispatch (`runTool`) does not consult `TOOL_MODES`; the map gates *advertisement* only, so removing an entry never breaks a direct call.

The membership map lives next to the definitions (`tools/definitions/index.ts`), and its source of truth is the prompts: a tool is in a mode iff that mode's prompt tells the model to call it. The **Claude CLI adapter is not gated** — it routes tools through the MCP server, which stays full-surface. So does the MCP server for external agents.

### Prompt caching

The tools + system prefix is static across a session, so the API adapters cache it instead of re-billing ~7-8K tokens of schema every turn of a multi-turn loop. All per-turn content (the context wrapper, budget snapshot, attachments — see **Context Enrichment**) rides in the user messages, after the prefix, so the prefix stays identical turn-to-turn.

- **Anthropic** marks the system block with `cache_control: { type: "ephemeral" }`. One breakpoint at the end of system caches everything before it in the prefix hierarchy — tools, then system. Cache hits show up as `cache_read_input_tokens` in usage from turn 2 on.
- **OpenAI** caches eligible prefixes (>~1024 tokens) automatically, no flag — the adapter's job is to keep the prefix byte-stable: the system message is immutable for the session and leads every request, tools follow the same definition order, dynamic content never bakes into either.

This is in-process-adapter only; the Claude CLI manages its own caching.

### Mutation cache invalidation

The app invalidates caches per mutation tool call (not per turn) so the UI reflects Capy's changes live as it works. `MUTATION_TOOL_NAMES` is exposed for matching.

### Channel tools

Some tools are communication channels, not data calls: the model emits them and the UI renders the result rather than feeding a string back to the model. They are no-ops on the dispatch side (`runTool` returns a short ack — `isDispatchTool` recognizes them, but no handler runs), and every adapter converts the `tool_use` into a `ContentBlock` through the shared map in `render-map.ts`. A malformed payload returns `null` from the builder, and the adapter falls back to a `tool-activity` block so the session keeps moving. Adding such a tool means a definition + a builder, nowhere else.

| Tool | Mode | Input | Renders as |
|---|---|---|---|
| `render_table` | chat | `{ headers, rows }` | Data table with amount coloring |
| `render_chart` | chat | `{ title, type: "bar" \| "donut", data: [{label, value}] }` | Horizontal bar chart or SVG donut chart with legend, per `type` |
| `render_followups` | chat | `{ chips: [{label, prompt}] }` (1–4 items) | Follow-up suggestion chips after an answer. |
| `report_status` | import | `{ status }` | One progress line in the import run's status channel (see **Status channel**). |

`render_followups` is a **terminal-signal tool**: when the model calls it, the assistant turn is over. The API adapters dispatch the call (so the UI gets the chips) and push the tool_result to history, then exit the agentic loop without making another request. Skipping the ack round-trip saves a full stream per turn. The Claude CLI runs the loop in-subprocess; the prompt tells the model to stay silent after calling `render_followups`, and the stream parser suppresses any empty/whitespace-only assistant text it still emits.

## MCP Server (External Agents)

The MCP server is a thin transport: it wires the tool definitions to ListTools and `runTool()` to CallTool. It exposes the **full surface** (`getToolDefinitions()` with no mode) — external agents (Claude Desktop / Cursor / VS Code Copilot) drive their own flows and aren't constrained to a single chat/import mode. The in-process API adapters are mode-gated (see **Mode gating**); dispatch behavior is identical across both.

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
  provider: "claude-cli" | "anthropic" | "openai" | null
  anthropic: { apiKey: string; model: string }
  openai:    { apiKey: string; model: string }
  claudeCli: { model: string } // "" lets the CLI pick its default
}
```

Settings lives in the `/budget` Intelligence section. It renders a provider radio + per-provider config (API key where applicable, model picker, test-connection button). The radio order is **Off / Anthropic API / OpenAI API / Claude Code**; Claude Code carries an `advanced` badge and sits last as the source-build option. First-run defaults to `null` — users must explicitly pick a provider so they're never surprised by quota usage. The radio's "Off" label maps to `null` at the form boundary. Claude Code is auto-detected via `claude --version` and disabled in the picker if not installed.

Every provider uses one shared model picker: a curated dropdown plus a "Use a custom model" toggle that swaps in a free-text field for any model ID outside the list. A saved model not in the curated list opens the field in custom mode, so a user's pinned model survives a refreshed list. The curated options:

- **Anthropic** — Claude Opus 4.8 (`claude-opus-4-8`), Claude Sonnet 4.6 (`claude-sonnet-4-6`, the default), Claude Haiku 4.5 (`claude-haiku-4-5`).
- **OpenAI** — GPT-5.5 (`gpt-5.5`, the default), GPT-5.4 mini (`gpt-5.4-mini`), GPT-5.4 nano (`gpt-5.4-nano`).
- **Claude Code** — Default (empty, the CLI decides), plus the `opus` / `sonnet` / `haiku` aliases. A non-empty value passes through as the CLI's `--model` flag at spawn; empty omits the flag.

When `provider === null`, the Capy overlay shows an empty-state CTA instead of the chat UI.

The Intelligence section also hosts a chat-instructions editor for `capy-instructions.md` (see Custom Instructions). The same file is editable from the Capy overlay; edits apply to the next conversation. The web demo can't store an AI provider, so it renders the provider list disabled behind a desktop-only notice and omits the per-provider config and the chat-instructions editor; Categories management stays fully functional.

## Context Enrichment

Each user message is wrapped with app context before sending. The first message of a session also carries a compact **budget snapshot** — account and transaction counts, the date range, and the category list — so Capy knows the shape of the data without a tool round-trip.

```
[Context]
Budget: personal
Date: March 15, 2026
Budget folder: /path/to/budget

[Budget snapshot]
Accounts: 4 active
Transactions: 1820 (2020-01-03 → 2026-03-14)
Categories:
  Income: Paycheck, Other Income
  Fixed: Housing, Bills & Utilities, Subscriptions
  Daily Living: Groceries, Dining Out, Transportation
  ...

[User message]
What did I spend on food this month?
```

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

All three prompts open with a shared **app-knowledge brief** (`specs/APP_KNOWLEDGE.md`, factored through `prompts/app-knowledge.ts`) so chat, import, and enrich each understand the same working model — the transaction log, accounts, categories, derived budgets, the analytics surface, who the user is, and what Capy's job is. It's a tight, purpose-built doc, not a spec dump: ~1.3K tokens of always-on common ground rather than the full schema and feature inventory.

The brief is sourced from `packages/intelligence/src/specs.generated.ts`, regenerated on every build by `scripts/generate-specs.ts`. For detail beyond the brief — the exact CSV schemas in `DATA_MODEL.md`, the full feature inventory in `PRODUCT.md`, the architecture, the import pipeline, the intelligence layer itself — capy calls `read_spec`.

## Import Sessions

Smart Import is **one orchestrated `CapySession`** that walks an ordered phase pipeline from dropped files to a merge-ready preview. The run works on every provider.

### One run, sequential injection

The run is owned by the import store and driven by a phase pipeline (`import/run-pipeline.ts`). Each phase is a small descriptor: a phase id, the deterministic pre-step the orchestrator runs (code-triggered tools dispatched via `runTool`, not advertised to the model), and the instruction block injected to start the phase.

The first phase, **normalize**, is the kickoff — driven by the import system prompt and the screen-built initial message. On each phase's `done`, the orchestrator runs the next phase's pre-step, then **injects that phase's instruction as a new user turn into the same session**. The model keeps full memory across phases (no enrich cold-start — the enrich turn already knows what normalize did) while each phase gets a sharp instruction block. The same in-process adapters that merge consecutive user turns make this a re-run of the agentic loop in one session, not a new session.

The pipeline is ordered and insertable: a phase is one entry. The runtime order the feature builds toward is **normalize → accounts → dedup → enrich**, with account mapping before dedup (dedup's rules key off the resolved account). The run lands on the terminal **review** — the preview/table where the user merges.

Phase machine: `idle → normalizing → accounts → dedup → enriching → review`. The store streams the run's phase plus live activity to the import screen throughout — a phase-driven progress bar and the `report_status` line/log (see **Status channel**), not prose; only `review` swaps to the preview table. Cancelling mid-run stops the session and resets to `idle`.

### Normalize

Takes dropped files, detects format, extracts transactions into a uniform CSV. Leaves enrichment columns empty.

- **Text sources (CSV / OFX / etc.)** are listed by name in the initial message; the agent calls `analyze_csv` → `preview_transform` → `transform_csv` to process them in code.
- **Images and PDFs** ride into the **initial user message as multimodal blocks** — image bytes become `image` content (rendered as `image_url` for OpenAI), PDF bytes become `document` content. The agent reads them directly from the message and calls `write_import_file` (with `mode: "append"` once it's already written rows from another source) to record extracted rows. Provider-specific handling (e.g. OpenAI replacing PDF blocks with a text note) lives in each adapter; the import screen stays provider-agnostic.

### Accounts

Maps each source account (the statement's `sourceAccount` string) to a Capy account, persisting `accountId` onto the staging rows. This is **agent judgment, not a fuzzy matcher** — source names are messy (emojis, abbreviations, case, variants), and resolving them is exactly what intelligence is good at and string matching was not. Imports are small (usually one source account), so this is a handful of decisions.

Precedence is **stored aliases > agent judgment > manual map in preview**:

- The phase's deterministic pre-step is `apply_account_aliases` (code-triggered): it reads `.capy/aliases.json` and sets `accountId` on rows whose `sourceAccount` has a known alias. Aliases are the authoritative top layer — prior user maps that pre-select reliably.
- The agent turn then maps the remaining unmapped source accounts via `enrich_update` (`set: { accountId }`). Because `enrich_update` only fills *empty* fields, aliased rows are never overridden — aliases win by construction. A source account with no plausible Capy match is set to the `"__create__"` sentinel, and merge creates the account from the source name.
- The manual map in the preview is the user's final override. It is also the **only** path that writes new aliases — the agent's mapping persists `accountId` to staging but never touches the alias file, so a guess can't become a sticky alias.

Account mapping precedes dedup (dedup's matching rules key off the resolved account) and enrich.

### Dedup

Finds staging rows that already exist in the budget and persists the verdict onto staging, so the preview becomes final review rather than work-in-progress. The principle is **matcher FINDS, model ADJUDICATES**: `detectDuplicates` (in core) is the deterministic finder — it returns `high` confidence (exact date+amount+description+account) and `low` confidence (date ±1, amount-only, fuzzy description). Because the accounts phase already resolved `accountId` onto every staging row, the finder's account-keyed rules now match correctly (the old frontend matcher silently degraded dedup to description-only).

- The phase's deterministic pre-step is `auto_mark_duplicates` (code-triggered): it runs the finder and auto-marks every **high-confidence** match. Exact matches need no judgment.
- The agent turn reviews the **low-confidence** candidates: it calls `find_duplicates` (summary + candidate set grouped by confidence, each with the matched original's merchant/category — never the full dataset) and calls `mark_duplicates` with the ids it judges to be genuine duplicates. The model passes only the verdict; the tool re-runs the finder to resolve each match's details.
- **Marking dup-enriches.** `mark_duplicates`/`auto_mark_duplicates` set `duplicate=true`, `duplicateOf` (the matched existing transaction id), and `duplicateConfidence`, and copy the matched original's `merchant`/`categoryId` onto the row (filling only empties). A dimmed preview row shows *what* it duplicates, and a false-positive merge is already cleanly categorized.
- **Halt path (orchestrator-owned, deterministic).** After the agent's dedup turn ends, the orchestrator reads the staging CSV and counts duplicate-marked rows. If every row is now a duplicate (high-confidence auto-marks + low-confidence agent marks all persisted), the whole import overlaps what's in the budget: the orchestrator **skips the enrich phase** and completes the run with a terminal `nothing-to-import` outcome whose message it builds from the count ("All N transactions are already in your budget — nothing to import."). The model does not decide or report the halt — its job is to mark genuine duplicates and end its turn; the code reads the persisted flags and decides. The `NOTHING_TO_IMPORT_SIGNAL` phrase is the canonical seam string the orchestrator's message is built from, for Unit 5's prominent terminal rendering.

These three staging fields (`duplicate`, `duplicateOf`, `duplicateConfidence`) live on the import staging CSV only — they never enter the committed budget schema. The preview reads them to dim and unselect duplicates; merge excludes duplicate-and-unselected rows.

### Enrich

Reads the normalized CSV, identifies merchants, and categorizes transactions using a mix of code-driven helpers (`auto_enrich` does fuzzy category matching and resolves transfer targets in one pass — it intentionally does NOT touch `merchant`, since the raw description is the wrong value for the cleaned-name slot) and bulk SQL-UPDATE-style calls (`enrich_update`). Account mapping already happened in the accounts phase, so by here every row's `accountId` is resolved. `auto_enrich` is code-triggered — the orchestrator runs it as the enrich phase's deterministic pre-step, not something the model calls. **Duplicate-marked rows are skipped:** `enrich_status` and `enrich_update` ignore rows with `duplicate=true` — they're excluded from the merge and were already dup-enriched (merchant/category copied from the matched original), so they don't count toward coverage and never appear in the work sample. (The all-duplicate case never reaches enrich — the dedup halt completes the run first.) The enrich phase follows accounts automatically via sequential injection; from the preview, the user can re-run enrich manually after edits (a standalone session over the same CSV).

`enrich_update` returns **per-field counts** of what landed (set vs skipped-as-already-populated). The model uses this signal to know when to stop pattern-matching instead of guessing from a single "Updated N rows" total. It validates `categoryId` against real budget category UUIDs — invented or stale IDs are rejected with a clear error pointing back at `list_categories`.

**Reusing past decisions.** Before guessing a category for a cryptic or unfamiliar description, the enrich prompt steers the model to `search_transactions` the user's committed history for the same merchant and adopt the `merchant`/`categoryId` they already settled on (at `"high"` confidence — it's the user's own choice, not an inference). The user's settled categorization beats a fresh keyword guess. Recurring merchants that duplicate existing rows already inherit that category in the dedup phase (dup-enrich), so this lookup mainly serves new, cryptic rows.

**Idempotency.** Enrich begins with `enrich_status`. If coverage is already complete (merchant + category on every non-transfer row), the session reports the work is done and stops without further calls. Pressing enrich on already-enriched data is a fast no-op. Stop conditions are explicit: full coverage, or two consecutive `enrich_update` calls produce zero actual changes, or the per-session tool-call budget is approaching exhaustion.

The `categoryConfidence` field coordinates between AI and user: enrichment writes `"high"` (merchant history match) or `"low"` (keyword inference), and skips rows where confidence is `"high"` (user-confirmed). The UI shows a confidence dot indicator next to each category.

The run and the standalone re-enrich both use the `CapySession` interface, run in `import` mode (the same gated tool surface), and open with the shared app-knowledge brief — the per-phase instruction blocks (injected as user turns for the run; the system prompt for a standalone re-enrich) are what differ.

### Status channel

During the run, Capy communicates **only** through a structured status channel — no prose. Every import prompt instructs the model to write no free text and to call `report_status` (a [channel tool](#channel-tools)) with one short present-tense line per step ("Reading your March statement…", "Found 12 overlaps, marking them…"). The adapter converts each call into a `status` ContentBlock; the import store intercepts those blocks to drive the status line and never lets assistant text drive it. This is the UX and a token win — no paragraph generation. Tool-activity (which tools ran) rides along as secondary detail.

The store holds the channel state, reset on every run start / resume / cancel / merge:

- **Status line** — the latest `report_status` text, the current step.
- **Log** — prior lines, newest-first, each stamped with when a newer line superseded it (`Date.now()`, the browser runtime). Consecutive duplicate lines are ignored so a re-report doesn't spam the log.

**Progress bar.** Discrete segments — `normalize → accounts → dedup → enrich → done` (`IMPORT_SEGMENTS` / `IMPORT_PHASE_SEGMENT` in core) — fill as phases complete. The bar is driven by the real phase machine, never a model-emitted percentage, so it is always correct. The active phase's segment is in progress, earlier ones complete, later ones pending. The terminal `review` phase maps to `done`, which sits past every work segment — so all four read complete. That also covers the all-duplicate halt (dedup short-circuits straight to `review`, skipping enrich): the bar lands fully done rather than leaving enrich pending forever.

**Terminal moments are results, not log lines.** The run's outcome (`runOutcome`, set by the orchestrator on completion) renders prominently, distinct from the running status line/log:

- **Halt** (`nothing-to-import`) — the all-duplicate message ("All 23 transactions are already in your budget — nothing to import.") replaces the preview table; the only action is to finish.
- **Completion** (`ready`) — a merge-ready summary ("47 ready, 3 duplicates dimmed.") sits above the preview table. The counts come from the staging tally the orchestrator already reads (ready = non-duplicate rows; duplicates = rows the dedup phase marked) — single source, no UI recompute.
- **Error** (`error`) — a run that fails mid-flight (stream error or, on the Claude CLI, the subprocess dying) lands an `error` outcome; the phase stays put so the screen keeps the processing view, where the failure renders as a prominent result rather than a buried log line.

## Session Tool-Call Budget

Every `CapySession` enforces a per-session cap of **100 tool calls** as a runaway-loop backstop. When exceeded, the session emits a `StreamEvent.error` describing the budget exhaustion and terminates that turn cleanly. The user sees the error and can run again; the budget resets per session.

This is a hard backstop, not the normal path. Idempotent enrichment and well-formed prompts converge in tens of calls even on multi-year imports. The cap exists to bound the failure mode when something goes wrong.

Enforcement varies by adapter:

- **Anthropic / OpenAI** count tool calls inline as they dispatch them. When the cap trips mid-turn, remaining tool_use blocks in the same turn receive a budget-exhausted error result (so the API doesn't see dangling tool_use) and the agentic loop exits without making the next request.
- **Claude CLI** parses each cumulative assistant snapshot, dedups tool_use IDs into a Set, and kills the subprocess + surfaces the error event when the Set grows past the cap. The CLI can't be told to stop from outside, so termination is the cleanest signal we can give.

## Per-provider Stop / Restart

| | Claude CLI | Anthropic + OpenAI |
|---|---|---|
| `stop()` | kill subprocess + new session ID; serialize prior chat and prepend on next send | abort in-flight request; drop trailing assistant turn with unmatched tool calls; messages otherwise intact |
| `restart()` | kill + new session ID + clear recovery state | abort + clear messages |
| Recovery on next send | `[Previous conversation]` block prepended | continues normally |

The recovery dance is unique to the CLI (it can't reliably resume a session interrupted mid-turn). API adapters get a clean model because `AbortController` doesn't leave them in an ambiguous state.
