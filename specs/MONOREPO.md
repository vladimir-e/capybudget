# Monorepo Structure

npm workspaces monorepo. Shared logic lives in packages. Deployment targets are thin shells that mount the shared React application with platform-specific adapters.

## Packages

| Package | Name | Purpose |
|---|---|---|
| `packages/core` | `@capybudget/core` | Types, money utilities, pure entity service functions |
| `packages/persistence` | `@capybudget/persistence` | Repository interface, file adapter, CSV implementation |
| `packages/intelligence` | `@capybudget/intelligence` | Session interface, stream events, content blocks, system prompt |
| `packages/app` | `@capybudget/app` | Full React application — components, hooks, stores, routes |
| `packages/mcp` | `@capybudget/mcp` | Standalone MCP server for any AI agent |

## Shells

Thin deployment targets. Each provides platform adapters and mounts `<App />` from `@capybudget/app`.

| Shell | Location | Purpose |
|---|---|---|
| Desktop | `src/` + `src-tauri/` | Native Tauri app with local file I/O and Claude CLI |
| Demo | `apps/demo/` | Browser-based demo with preset data (demo.capybudget.app) |
| Website | `apps/www/` | Promo site — Astro 6 static, deployed to Vercel (capybudget.app) |

## Dependency Graph

```
              core
           ↗   ↑   ↖
  persistence ←─ intelligence
       ↑  ↖     ↗  ↑
       │    app     │
       │   ↗   ↖   │
      desktop  demo │
                    │
          mcp ──────┘
```

Core depends on nothing. `intelligence` depends on `persistence` so
the in-process tool dispatch (used by API-adapter sessions and re-used
by the MCP server) can take a `BudgetRepository` + `FileAdapter`.
No circular dependencies.

## Platform Seams

The app is written against the desktop platform; the demo replaces what it can't run. Only the repository travels through React context:

**BudgetRepository** (`@capybudget/persistence`) — provided by the route that owns the budget subtree, through `RepositoryProvider`. Desktop: the app's `/budget` route builds a CSV repository over the Tauri file adapter. Demo: its own `/budget` route builds an in-memory repository from generated data.

**FileAdapter** (`@capybudget/persistence`) — file read/write/rename/join. Desktop: `src/adapters/tauri-file-adapter.ts` (Tauri plugin-fs), which the app's `/budget` route and import orchestrator hook import by relative path. Demo: its routes don't use it; the Tauri plugins underneath are aliased to stubs.

**CapySession** (`@capybudget/intelligence`) — built by `app/services/create-session.ts` from `API_ADAPTERS` plus the Claude CLI constructor in `app/services/claude-cli-session.ts` (a `ClaudeCliHost` over the Tauri shell). Demo: a Vite alias swaps that constructor for a stub session prompting local install.

**Budget service** — budget detection, bootstrap, and the schema version. Desktop: `src/services/budget.ts` (Tauri fs + dialog), which the app's budget selector, launch redirect, and budget-meta hook import by relative path. Demo: its own budget selector and preset data loader.

So the app reaches into the desktop shell by relative path, and the demo substitutes at build time: its own routes for the budget entry points, Vite aliases for the Tauri plugins and the Claude CLI session. A new shell substitutes the same modules the same way.

## What Lives Where

**`@capybudget/core`** — domain types (Account, Category, Transaction and unions), money utilities, pure entity services (CRUD for accounts, categories, transactions), bulk operations, merchant matching. Zero platform dependencies.

**`@capybudget/persistence`** — `BudgetRepository` interface, `FileAdapter` interface, `CsvRepository` implementation, CSV parsing with typed coercion, debounced writer. Depends on core for types. The `BudgetRepository` interface is the extension point for future storage backends (database, etc.). `FileAdapter` is specific to the CSV implementation.

**`@capybudget/intelligence`** — `CapySession` interface, stream event types, content block types, system prompt template, context builder, tool definitions and in-process dispatch (`runTool`), provider config types, model fallbacks, and the `createIntelligenceSession` factory. Everything that touches a provider SDK lives in `intelligence/src/adapters/` behind the `@capybudget/intelligence/adapters` subpath, so the main barrel stays SDK-free: `API_ADAPTERS` (`AnthropicSession`, `OpenAiSession` on the Responses API, `OllamaSession` — Chat Completions against a local server), `pingProvider` / `listModels` for Settings, and `ClaudeCliSession` under `adapters/claude-cli/`, which takes its process driver as an injected `ClaudeCliHost`. Depends on core (types) and persistence (`BudgetRepository` + `FileAdapter` for tool dispatch). See `INTELLIGENCE.md`.

**`@capybudget/app`** — all React components (budget UI, capy overlay, shadcn primitives), TanStack Query/Router hooks, Zustand stores, routes, context providers for dependency injection. Depends on core, persistence, intelligence.

**`@capybudget/mcp`** — standalone MCP server. Thin stdio transport over the intelligence tool layer (`getToolDefinitions` + `runTool`) with a node `fs` `FileAdapter`. Depends on core, persistence, and intelligence. See `INTELLIGENCE.md`.

## Import Convention

- `@capybudget/*` for shared packages
- `@/` alias for app-internal imports within `packages/app`
- kebab-case file naming throughout
