# Intelligence Providers — Refactor Plan

Status: planning. Authored before any code changes. Once implementation lands, the architectural sections fold into `INTELLIGENCE.md`; the planning sections (decisions, open questions) get pruned.

## Why

Today the intelligence layer is hard-wired to Claude Code CLI. That gates the whole AI experience behind one external dependency. Two real users we care about can't use the app:

1. People who don't have Claude Code installed and don't want to install it.
2. People with Anthropic API or OpenAI API keys (subscriptions or paid usage) who want to plug those in instead.

Goal: turn intelligence into a pluggable layer. Three providers as **adapters** behind a single contract:

- **Claude Code** — current behavior, default if installed.
- **Anthropic API** — direct API calls with user-supplied key.
- **OpenAI API** — same, with OpenAI's key.

The app is pre-launch. No backwards compatibility; we restructure for the right shape now.

## Today's Architecture (Quick Recap)

```
useCapySession ──┐
import-store ────┼──▶ CapySession (concrete class, packages/app/src/services/capy-session.ts)
                 │       │
                 │       └─▶ Tauri Command.create("claude", ...) → spawns claude-cli
                 │             │
                 │             └─▶ MCP server (npx tsx packages/mcp/src/server.ts)
                 │                   │
                 │                   └─▶ FileAdapter (node fs) → BudgetRepository
                 │
                 └──▶ parseStreamLine() decodes claude-cli stream-json into StreamEvent
```

Key facts:

- `CapySession` interface in `@capybudget/intelligence` is small (send/stop/restart/kill/isAlive/onEvent). Already the right seam — but only one implementation exists.
- The class also named `CapySession` in `packages/app/src/services/capy-session.ts` is the desktop adapter — spawns `claude` and pipes stream-json. The interface and the implementation share a name.
- Three callsites instantiate it directly: `use-capy-session` (chat), `import-store.startNormalization`, `import-store.startEnrichment`. None go through a factory.
- All tool execution flows through MCP. The MCP server is its own Node subprocess. Data + mutation tool handlers take a `BudgetRepository` (already FileAdapter-backed). Import + CSV tool handlers use Node `fs` directly — they couldn't run in the renderer today.
- Demo shell has its own stub `CapySession` that fakes responses (`apps/demo/src/adapters/demo-capy-session.ts`).

## Target Architecture

### Naming

User-facing: **provider** ("AI Provider", "Anthropic API"). Code: **adapter** (matches MONOREPO.md's existing adapter pattern).

### The seam

`CapySession` interface stays as-is — it's already the right contract. We add a factory and per-provider implementations:

```
                       ┌─ ClaudeCliSession (subprocess, MCP transport)
createIntelligenceSession(config, opts) ──▶ ┼─ AnthropicSession  (in-process, in-process tools)
                       └─ OpenAiSession     (in-process, in-process tools)
```

`config: IntelligenceConfig` is the user setting (provider choice, API key, model). `opts` is the runtime context (budget path, callbacks, etc).

The Demo shell continues to inject its stub via a different code path — out of scope here.

### Two transport models

- **Claude Code adapter** keeps the existing setup: subprocess + MCP server. No reason to change a working integration.
- **API adapters** run the agentic loop in the renderer, dispatch tool calls in-process. No subprocess, no MCP transport. They share tool *handlers* with the MCP server but talk to them via direct function calls.

Why two models? The MCP server exists for a reason — it's also the integration surface for external agents (Claude Desktop, Cursor). It stays. For *internal* API adapters, an MCP roundtrip is pure overhead — the renderer already has the repo and file adapter. Direct dispatch is simpler and faster.

### Tool layer reshape

Extract tool definitions and handlers into a layer that both the MCP server and the API adapters can use:

```
@capybudget/intelligence/tools/
  definitions.ts   — tool schemas (name, description, JSON-Schema input)
  dispatch.ts      — single dispatch entrypoint: runTool(name, input, ctx) → result string
  handlers/
    data.ts        — moved from mcp/data-tools.ts
    mutation.ts    — moved from mcp/mutation-tools.ts
    import.ts      — refactored to take a FileAdapter, moved from mcp/import-tools.ts
    csv.ts         — refactored to take a FileAdapter, moved from mcp/csv-tools.ts
    render.ts      — descriptors only; render is a no-op on dispatch (frontend intercepts)
```

`@capybudget/mcp` then becomes a thin transport: it wires `definitions` to `ListTools` and `dispatch` to `CallTool`. The handlers move out — that's the work.

Tool context shape:

```ts
interface ToolContext {
  repo: BudgetRepository
  fileAdapter: FileAdapter
  budgetPath: string
}
```

Both the MCP server (with node fs adapter) and the renderer (with Tauri fs adapter) inject the same shape.

### Render tools

Already a special case. They're descriptors that carry data from the model to the frontend; the MCP "execution" returns "Rendered." and the app intercepts the tool_use event and emits a `ContentBlock`.

For API adapters, do the same: when the model emits a `render_*` tool call, emit the corresponding ContentBlock (`table`, `bar-chart`, `donut-chart`) and return `"Rendered."` as the tool result, so the loop continues.

### Read tool

Claude Code provides the `Read` tool natively. API adapters need to expose an equivalent. Implement it as another tool in `definitions/dispatch`, scoped to budget folder (uses Tauri fs in renderer, node fs in MCP). Allow-listed paths only — same scope as `--add-dir <budgetPath>` today.

### Provider differences (for the agentic loop)

| | Anthropic | OpenAI |
|---|---|---|
| Endpoint | `messages` | `responses` (or `chat.completions`) |
| Tool format | `{ name, description, input_schema }` | `{ type: "function", function: { name, description, parameters } }` |
| Tool call in response | `content[i].type === "tool_use"` with `.id, .name, .input` | `output[i].type === "tool_call"` with `.call_id, .name, .arguments` (JSON string) |
| Tool result | `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }` | `{ type: "tool_call_output", call_id, output }` |
| Image input | `{ type: "image", source: { type: "base64", media_type, data } }` | `{ type: "input_image", image_url: "data:image/...;base64,..." }` |
| Streaming | SSE with content_block deltas | SSE with delta events |

Each adapter does the conversion locally. The agentic loop itself is identical: send → stream → if tool_use, dispatch → append tool result → repeat → done.

### Settings

User-facing settings live in a new app-level store and persist via `@tauri-apps/plugin-store` (already a Tauri pattern, file-based, in `appConfigDir`).

```ts
interface IntelligenceConfig {
  provider: "claude-cli" | "anthropic" | "openai" | null  // null = unconfigured
  anthropic: { apiKey: string; model: string }
  openai:    { apiKey: string; model: string }
}
```

API keys live in the same store for v1 (recommendation; see Open Questions). New `/settings` route, accessible from the gear in the budget shell or from the empty-state Capy overlay.

### Detecting Claude Code

Probe `claude --version` via Tauri shell on app startup; cache the boolean for the session, re-probe on settings page open. If absent, the Claude Code radio is disabled with a small "not detected" hint and a link to `claude.ai/code`.

If the user previously had Claude Code selected and it disappears (uninstalled), settings shows a warning and they need to pick another provider before chat works again.

### "Not configured" state

When `provider == null` and the user opens Capy, the overlay shows an empty-state card: "Set up your AI assistant" → button opens settings. Same card if `provider == "anthropic"` but no API key. The Capy button itself stays visible — clicking it always opens the overlay; the overlay is what nudges to settings.

### Per-provider stop / restart semantics

Claude Code subprocess gymnastics (kill process → new session ID → forward [Previous conversation] context on next send) is unique to the CLI. API adapters get a much simpler model: `stop()` aborts the in-flight `fetch` via `AbortController`; messages stay; next `send()` continues normally. Worth noting: the existing `sessionInterruptedRef` and `serializeConversation` machinery in `use-capy-session` becomes Claude-CLI-specific. We can either:
- Move that recovery logic into `ClaudeCliSession` so API adapters get the clean model, or
- Leave it in the hook (cheap, harmless for API adapters since they handle stop natively).

Recommendation: move it into `ClaudeCliSession`. The hook gets simpler; "session interrupted" UX still works because the session class can prepend the recovery context internally.

## What Stays, What Changes, What's New

**Stays:**
- `CapySession` interface in `@capybudget/intelligence`.
- All content block types, stream events, system prompts.
- `@capybudget/mcp` server as the integration surface for external agents (Claude Desktop, Cursor) — minus the handler logic that moves out.
- Demo stub.
- Tauri plugins, repository pattern, FileAdapter.

**Changes:**
- `useCapySession` and `import-store` go through `createIntelligenceSession(config, ...)` instead of `new CapySession(...)`.
- Tool handlers (data, mutation, import, csv) move from `@capybudget/mcp` to `@capybudget/intelligence/tools`. MCP server becomes a thin transport wrapping `dispatch`.
- Import + CSV tool handlers refactored to take a `FileAdapter` instead of using Node `fs` directly.
- Stop/restart recovery logic moves into `ClaudeCliSession`.
- `specs/INTELLIGENCE.md` updated to document multi-provider architecture.
- ROADMAP.md: new bullet under Phase 10 (probably 10.5.x — fits the "intelligence layer hardening" theme).

**New:**
- `AnthropicSession`, `OpenAiSession` adapters in `packages/app/src/services/`.
- `claude-cli-detect.ts` probe.
- `intelligence-store.ts` Zustand store + Tauri plugin-store persistence.
- `/settings` route + components.
- Empty-state UI for unconfigured Capy.
- Read tool implementation for API adapters.
- Tests for adapters (mocked SDKs) and dispatch.

## Open Questions (need a decision)

These are real forks. My recommendation in **bold**.

1. **API key storage location.**
   - **Tauri plugin-store (file-based, app config dir, plain JSON) — ship now, simple, consistent with our local-first ethos.** Add a note to README that keys live in a config file.
   - System keyring / Stronghold — more secure but adds a dep and surface area.
   - We can ship A and migrate to B later without user-facing churn.

2. **Custom base URL / OpenAI-compatible endpoints (Groq, Together, Ollama, etc).**
   - **Skip in v1.** Three providers with sensible defaults. Add a power-user "Custom endpoint" later.
   - Or: ship a "base URL" advanced field on day one — cheap to add, signals openness.

3. **Model selection in v1.**
   - **Ship a dropdown with curated defaults per provider, plus a "Custom model name" text field.** Anthropic: Sonnet 4.6 default, Opus 4.7 / Haiku 4.5 alternatives. OpenAI: GPT-5 default, GPT-4.1 alternative.
   - Or: one hardcoded best-default per provider, no UI for v1.

4. **Tool layer extraction scope.**
   - **Move data + mutation tools to `@capybudget/intelligence/tools` now; refactor import + CSV tools to `FileAdapter` in the same change.** Lets API adapters cover chat *and* import on day one.
   - Or: ship chat-only first (data + mutation tools moved, import tools stay node-only), require Claude Code for import. Smaller PR but creates a confusing UX gap.

5. **Settings UX placement.**
   - **Dedicated `/settings` route reachable from a gear icon in the header and from the unconfigured-Capy CTA.** Clean, discoverable.
   - Or: in-overlay settings panel only. Less visual chrome but harder to find for first-run.

6. **Should `IntelligenceConfig` be per-budget or app-global?**
   - **App-global.** API keys aren't budget-specific; one user, one set of credentials. Custom instructions and commands stay per-budget.

7. **Render tools — keep MCP-style or expose simpler block-emit API?**
   - **Keep MCP-style.** The model already knows the tool surface. Re-using the same descriptor everywhere is less surface area to maintain.

8. **Where does `@capybudget/intelligence/tools` live in the dep graph?**
   - Currently intelligence depends on core only. To host the handlers, it'll also depend on persistence (for `BudgetRepository` types and `FileAdapter`). That's fine — no circular dep.
   - **OK to add the dep.** Update MONOREPO.md graph.

## Phased Implementation

Two phases. Each phase ships independently — Phase A unblocks the API key story; Phase B brings imports along.

### Phase A — Pluggable chat (target: ~2–3 days)

Deliverables:
1. `IntelligenceConfig` type + `intelligence-store.ts` + Tauri plugin-store persistence.
2. `claude-cli-detect.ts` probe.
3. Move data + mutation tool handlers from `@capybudget/mcp` to `@capybudget/intelligence/tools`. MCP server becomes a thin transport.
4. Implement in-process `dispatch.ts` for renderer-side tool calls.
5. `ClaudeCliSession` (rename current implementation, move stop/restart recovery into it).
6. `AnthropicSession` (new) — agentic loop with tool dispatch + render-block emit + Read tool.
7. `OpenAiSession` (new) — same.
8. `createIntelligenceSession(config, opts)` factory.
9. `/settings` route with provider radio + per-provider config.
10. Empty-state in Capy overlay when unconfigured → "Open settings" CTA.
11. `useCapySession` + `import-store` updated to use the factory. (Import flow still requires Claude Code at this point — or punts to Claude Code if API adapter is selected and import is attempted; flag that clearly.)
12. Tests: unit tests for each adapter (mocked SDKs), dispatch tests, settings store tests.
13. Docs: update INTELLIGENCE.md.

Exit criteria: switch between three providers in settings, send chat messages, get correct streaming + tool-call behavior in each.

### Phase B — Imports on API adapters (target: ~1–2 days)

Deliverables:
1. Refactor `import-tools.ts` and `csv-tools.ts` (currently in `@capybudget/mcp`) to take a `FileAdapter`. Move them under `@capybudget/intelligence/tools/handlers/`.
2. MCP server uses node FileAdapter for these handlers.
3. Renderer dispatch uses Tauri FileAdapter for these handlers.
4. Wire import normalize + enrich flows to work with API adapters.
5. End-to-end test: drop a CSV, normalize + enrich, with each provider.
6. Docs.

Exit criteria: full feature parity between providers — chat *and* import work for all three.

## Risks / Things That Could Bite Us

- **Streaming differences.** OpenAI's response-streaming events are differently shaped than Anthropic's. Each adapter needs its own stream-to-StreamEvent mapping. Cumulative-vs-delta semantics already handled by `appendNormalizeBlock` / use-capy-session — both adapters should emit cumulative, like Claude does, so no UI change.
- **Tool-call ID handling.** Anthropic uses `id`, OpenAI uses `call_id`. Easy but needs care.
- **JSON arguments parsing.** OpenAI streams tool arguments as a JSON string in deltas; need to accumulate before parsing. Don't try to parse partial JSON.
- **API key in a webview process.** Tauri webview is sandboxed; no XSS risk if we don't load remote content. We don't. Still: never log keys, never send them to anything except the API endpoint.
- **Claude Code probe flakiness.** Some users have `claude` aliased to a local script. Probe should accept any zero-exit-code response, not parse output strictly.
- **Conversation history on stop for API adapters.** Don't append a partial assistant turn that has tool_use blocks but no tool_result blocks — would confuse the next request. Either drop the partial turn entirely on stop, or fabricate cancelled tool_results. Recommendation: drop the partial assistant turn.
- **Cost surprise.** A user types "categorize all my transactions" against GPT-5 and spends $5 in tokens. Future feature: show running token usage / estimated cost at end of message. Not v1, but worth noting.
- **Tool-extraction PR is large.** The mcp → intelligence move touches many files. Worth its own commit (or even its own PR) so the actual adapter change is reviewable.

## What This Is Not

- Not a rework of the MCP server's external integration story. It still works for Claude Desktop, Cursor, etc.
- Not a change to the demo stub. That stays.
- Not auth flows or OAuth. Just BYO keys.
- Not a router for "use cheap provider for X, expensive for Y." One provider per app instance, swap in settings.
- Not a usage/cost dashboard. Possibly later.

## Round 2 — Anthropic adapter

Landed: `AnthropicSession` at `packages/app/src/services/anthropic-session.ts`, wired into the factory in `create-session.ts` and threaded with `repo` + `fileAdapter` from `useCapySession` (via `use-session-lifecycle`) and the import store. SDK dependency `@anthropic-ai/sdk` lives only in `@capybudget/app` — the intelligence package stays SDK-agnostic. Tests at `packages/app/src/services/anthropic-session.test.ts` cover one-turn streaming, tool dispatch, error surfacing, stop-mid-tool, and kill.

The adapter synthesizes Claude-CLI stream-json lines (`assistant` / `result` / `error`) and emits them as `SessionEvent` `stdout` events, so `parseStreamLine` and the cumulative-text merging in `use-capy-session` / `appendNormalizeBlock` work without modification — the only cost is one shape-conversion in the adapter, the benefit is zero UI changes. Text deltas from the SDK are accumulated locally before emit, matching the cumulative semantics of Claude CLI's wire format.

`stop()` aborts the in-flight `messages.stream()` via `AbortController`, drops any trailing assistant turn that has unmatched `tool_use` blocks (the API would 400 on the next request otherwise), and sets an `interrupted` flag the agentic loop checks after `runTool` so partial tool_results that reference a dropped turn never get pushed into history. `kill()` flips `isAlive` false and prevents further work; `restart()` resets history.

Tool surface: chat-relevant only (data + mutation + render via `getToolDefinitions()`). Import + CSV tools and a Read tool arrive in Phase B. The Anthropic SDK's `Tool` type is structurally compatible with the intelligence package's `ToolDefinition` so the converter is a one-line shape massage.

Imports still run on Claude CLI in Phase A — if a user has Anthropic selected and tries to import, the import store's `createSession` returns a session that can dispatch chat tools but the import flow itself still expects MCP-side import handlers. Phase B refactors those handlers to take a `FileAdapter` and routes them through `dispatch.ts`, at which point Anthropic-driven imports work end-to-end.

## Round 3 — OpenAI adapter

Landed: `OpenAiSession` at `packages/app/src/services/openai-session.ts`, wired into the factory in `create-session.ts`. SDK dependency `openai` lives only in `@capybudget/app`; the intelligence package stays SDK-agnostic. Tests at `packages/app/src/services/openai-session.test.ts` cover one-turn streaming, tool dispatch with arguments accumulation across many deltas, the per-index argument accumulator under independent verification, error surfacing, stop-mid-tool, and kill.

API choice: **`chat.completions.create` with `stream: true`**. Reasons documented at the top of the file — chat.completions is the stable, version-broad path (GPT-4 family, GPT-4o, GPT-4.1, GPT-5); the newer `responses.create` would force a divergent tool-call shape and subtler streaming semantics. Revisit if a model becomes responses-only.

The shape mirrors `AnthropicSession` deliberately: same lifecycle (`send`/`stop`/`restart`/`kill`), same `interrupted` flag pattern that drops trailing assistant turns with unmatched `tool_calls` (OpenAI's analogue of unmatched `tool_use`), same Claude-CLI-shaped synthetic stream-json (`assistant` / `result` / `error`) emitted as `SessionEvent` `stdout` events so `parseStreamLine` and downstream cumulative-text merging work without modification. Helper functions (`assistantLine`, `errorLine`, the cumulative-text accumulator) are duplicated rather than extracted — pragmatic over DRY since the two adapters will drift as providers diverge.

Protocol deltas handled inline:
- **Tools** wrapped as `{ type: "function", function: { name, description, parameters } }`.
- **Tool calls stream as deltas** — `id`, `name`, and `arguments` arrive piecewise. A per-`tool_call.index` accumulator (`Map<index, { id, name, argsString }>`) collects fragments; `argsString` is parsed as JSON only after the stream finishes. Partial JSON is never parsed.
- **Tool results** are appended as `{ role: "tool", tool_call_id, content }` messages, one per call, after the assistant turn that triggered them.
- **Images** convert to `{ type: "image_url", image_url: { url: "data:${media_type};base64,${data}" } }`.
- **System prompt** is prepended as a `{ role: "system", content: ... }` message at the head of each request — kept out of `this.messages` so `restart()` clears cleanly.
- **Text deltas** are non-cumulative (`choices[0].delta.content`); accumulated locally before emit, matching Claude CLI's wire format.

`stop()` aborts the in-flight `chat.completions.create` via `AbortController`, drops any trailing assistant turn that has unmatched `tool_calls` (the API would 400 on the next request otherwise), and sets an `interrupted` flag the agentic loop checks after `runTool` so partial tool results that reference a dropped turn never get pushed into history. `kill()` flips `isAlive` false and prevents further work; `restart()` resets history.

Tool surface matches the Anthropic adapter: data + mutation + render via `getToolDefinitions()`. Import + CSV tools and a Read tool arrive in Phase B.

## Round 4 — Settings UI

Landed: `/settings` route at `packages/app/src/routes/settings.tsx`, backed by `SettingsScreen` in `packages/app/src/components/settings/settings-screen.tsx`. The screen renders a single AI Provider card with three radio options (Claude Code, Anthropic API, OpenAI API), each binding to `useIntelligenceStore` setters. Per-provider configuration appears below the radio: a status line + Test connection button for Claude Code; an API-key field (password input + show/hide toggle + last-4-chars confirmation), a model dropdown with a "Use a custom model" toggle, and a Test connection button for the API providers. Saves are inline — provider toggles fire immediately, model changes fire immediately, API keys debounce until `onBlur`. A subtle toast confirms provider switches; field-level changes rely on the persisted state being reflected in the form (the spec's recommendation against per-keystroke noise).

The Claude Code radio is disabled when `recheckClaudeCli()` returns false; an inline hint links to claude.ai/code via Tauri's shell `open` plugin (no in-webview navigation). Re-probe runs on mount via the same hook. If the user has Claude Code selected and the probe later returns false, an inline warning above the radio explains the situation without auto-flipping the setting.

Test connection buttons live on the settings page only — no `testConnection()` method on the session classes (small layering compromise: the page imports the SDKs directly for a one-shot ping, accepted because adding a method to every adapter is more surface area than we need elsewhere). For Claude Code the test is a fresh `recheckClaudeCli()`. For the API providers the page sends a tiny `"Hi"` message via the relevant SDK and reports success or a truncated error message inline (≤120 chars).

A Settings button (gear icon) lives in the header of `budget-shell.tsx`, near the theme toggles, navigating via TanStack Router's `useNavigate({ to: "/settings" })`. The settings page header has a Back button that prefers `router.history.back()` and falls back to navigating home, matching the "settings is a top-level route, no budget context" model.

When `provider === null` or an API provider has an empty API key, `capy-overlay.tsx` swaps the default empty state for a "Set up your AI assistant" card with an Open settings CTA. The chat input stays visible but is disabled with placeholder copy directing the user to settings — no layout jump when the user comes back configured. `useCapySession` already handles a null session from `createSession()` cleanly (single-turn error message), so the empty-state path needs no further session-layer changes.

A new shadcn-style `RadioGroup` primitive at `packages/app/src/components/ui/radio-group.tsx` wraps `@base-ui/react/radio` + `radio-group` with the project's styling (brand-tinted check state, focus rings consistent with other inputs).

Tests:
- `packages/app/src/components/settings/settings-screen.test.tsx` — provider radio toggles, model dropdown updates, API key save-on-blur, last-4-chars hint, custom-model toggle, test-button disabled state, claude-cli-missing warning, eye toggle.
- `packages/app/src/components/capy/capy-overlay.test.tsx` — empty state when provider is null or API key is empty, regular intro when configured, input disabled state.
- `packages/app/src/test/journeys/settings-nav.test.tsx` — gear icon in budget shell navigates to /settings.

## When This Lands

- Folds into ROADMAP.md as a new bullet under Phase 10 (after 10.4 — natural place; breaks out 10.5 "Intelligence layer hardening" into "10.5a Provider adapters" + "10.5b Hardening").
- After it ships, `INTELLIGENCE.md` is rewritten around the adapter model, with a short "Claude Code adapter" section, "Anthropic adapter" section, "OpenAI adapter" section, and a shared "Tool layer" section. This task file is then archived or deleted.

## Phase B — landed

Closed the import-flow gap. All three providers now run normalize + enrich end-to-end.

**Tool layer:**
- `FileAdapter` interface (`@capybudget/persistence`) extended with `mkdir`, `exists`, `readDir`, `appendFile`, `remove`, `stat`. Both `nodeFileAdapter` (mcp) and `tauriFileAdapter` (app) implement the full surface; the demo `tauri-fs.ts` stub mirrors it with an in-memory map.
- Import + CSV tool handlers moved from `@capybudget/mcp` to `@capybudget/intelligence/src/tools/handlers/import.ts` and `csv.ts`. Signatures changed from `(budgetPath, args)` to `(ctx: ToolContext, args)`. All filesystem access now goes through `ctx.fileAdapter`.
- `safeFilePath` no longer relies on Node's sync `path.resolve` — it joins via `fileAdapter.join` and string-prefix-checks against the joined parent directory. Same security guarantee, works on Tauri.
- New `read_file` handler (`@capybudget/intelligence/src/tools/handlers/read-file.ts`) for API adapters that lack Claude CLI's built-in `Read` tool. Scoped to budget folder + `.capy/import/sources/`.
- `getToolDefinitions()` now returns the full surface (data + mutation + import + csv + read_file + render). Both transports — MCP server and the in-process API adapters — see the same tools.
- MCP server (`packages/mcp/src/server.ts`) collapsed to a thin wrapper over `runTool`. The local `IMPORT_HANDLERS` switch is gone; everything routes through dispatch. External agents (Claude Desktop, Cursor) see no behavior change.
- `papaparse` dependency moved from `@capybudget/mcp` to `@capybudget/intelligence` since the CSV handlers live there now.

**Multimodal import flow:**
- `MessageContent` extended with a `document` block type (Anthropic-native PDF support).
- The import screen reads bytes for image / PDF source files via a new `readSourceFileBytes` method on `useImportRepository` and constructs a multimodal `MessageContent` array (text instructions + image / document blocks). The `import-store.startNormalization` API takes an `initialMessage: MessageContent` directly — the screen owns the construction.
- Anthropic adapter forwards `image` and `document` blocks natively. OpenAI adapter forwards images as `image_url` and replaces `document` blocks with an explanatory text note (the import UI gates PDFs upstream so this is belt-and-suspenders).
- `IMPORT_SYSTEM_PROMPT` updated: the "use Read tool" instruction is gone. Images and PDFs are described as "attached to your initial message — read them directly."

**UX:**
- The Phase A "Import requires Claude Code" banner is gone.
- New banner only shows when the user has dropped a `.pdf` while OpenAI is selected: "PDF imports need a provider with PDF support — switch to Claude Code or Anthropic, or remove the PDF file." The Start button stays disabled until the gate clears.

**Tests:**
- `packages/intelligence/src/tools/handlers/import.test.ts` — 14 cases covering read/write/append/list + path-traversal protection + auto-create.
- `packages/intelligence/src/tools/handlers/csv.test.ts` — 10 cases covering analyze / preview / transform (single + append) and the four enrichment tools.
- `packages/intelligence/src/tools/handlers/read-file.test.ts` — 6 cases covering bare-name + relative-path resolution and traversal rejections.
- `packages/intelligence/src/tools/handlers/test-utils.ts` — in-memory `MemoryFs` + `FileAdapter` factory shared by all three handler test suites.
- `packages/app/src/services/anthropic-session.test.ts` and `openai-session.test.ts` each gain two cases: an end-to-end import-flow walk (analyze_csv → preview_transform → transform_csv → done) using the mocked SDK, and a multimodal-forwarding case verifying the text + image + document conversion to provider-native shapes.
- `packages/intelligence/src/tools/dispatch.test.ts` updated: `isDispatchTool` now positively recognizes import + csv + read_file (was negatively asserted in Phase A).
- `packages/persistence/src/csv-repository.test.ts` mock adapter expanded to satisfy the extended `FileAdapter` shape.

**Decisions:**
- Picked **Option A** (extend `FileAdapter` itself) over Option B (separate `ImportFileAdapter`). One fewer interface, every method makes sense for any FS-like adapter, and both implementations had natural mappings.
- Picked **Option (a)** for OpenAI + PDFs — banner the user, don't try to render PDFs to images client-side. v1-appropriate scope.
- Cache for `readImportCsv` stays as a module-level Map keyed on file path. Added `__resetEnrichmentCacheForTests` so test isolation doesn't depend on globals leaking. Re-keying on `ctx.budgetPath` was tempting but per-path is exactly the right granularity — and matches the existing invalidation semantics.

**Files touched (high-level):**
- `packages/persistence/src/file-adapter.ts` (extended interface)
- `packages/persistence/src/csv-repository.test.ts` (mock adapter)
- `packages/mcp/src/{server.ts,index.ts,node-file-adapter.ts}` (transport simplified, adapter extended)
- `packages/mcp/package.json` (papaparse removed)
- `packages/intelligence/package.json` (papaparse added)
- `packages/intelligence/src/tools/{definitions.ts,dispatch.ts,index.ts}` (full surface)
- `packages/intelligence/src/tools/handlers/{import,csv,read-file,test-utils}.ts` + tests (new)
- `packages/intelligence/src/{import-prompt,types,index}.ts` (multimodal types + prompt updates)
- `packages/app/src/{services/anthropic-session,services/openai-session,stores/import-store,components/import/import-screen,hooks/use-import-repository}.ts/.tsx` (multimodal forwarding + UI)
- `src/adapters/tauri-file-adapter.ts` (extended adapter)
- `apps/demo/src/stubs/tauri-fs.ts` (binary `readFile` stub)
- `specs/{INTELLIGENCE,INTELLIGENCE_PROVIDERS,IMPORT,ROADMAP}.md`

Old `packages/mcp/src/{import-tools,csv-tools,import-tools.test}.ts` deleted — handlers + tests now live under intelligence.
