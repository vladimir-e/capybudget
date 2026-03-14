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
| Demo | `apps/demo/` | Browser-based demo with preset data (GitHub Pages) |

## Dependency Graph

```
              core
           ↗   ↑   ↖
  persistence  intelligence
       ↑  ↖     ↗  ↑
       │    app     │
       │   ↗   ↖   │
      desktop  demo │
                    │
          mcp ──────┘
```

Core depends on nothing. No circular dependencies.

## Adapter Pattern

Platform decoupling through three injected interfaces:

**FileAdapter** (`@capybudget/persistence`) — file read/write/rename/join. Desktop: Tauri plugin-fs. Demo: not used (in-memory repository).

**CapySession** (`@capybudget/intelligence`) — AI session lifecycle. Desktop: Claude CLI subprocess via Tauri shell. Demo: stub prompting local install.

**BudgetService** — budget detection and bootstrap. Desktop: Tauri fs + dialog. Demo: preset data loader.

Shells inject adapters via React context providers from `@capybudget/app`.

## What Lives Where

**`@capybudget/core`** — domain types (Account, Category, Transaction and unions), money utilities, pure entity services (CRUD for accounts, categories, transactions), bulk operations, merchant matching. Zero platform dependencies.

**`@capybudget/persistence`** — `BudgetRepository` interface, `FileAdapter` interface, `CsvRepository` implementation, CSV parsing with typed coercion, debounced writer. Depends on core for types. The `BudgetRepository` interface is the extension point for future storage backends (database, etc.). `FileAdapter` is specific to the CSV implementation.

**`@capybudget/intelligence`** — `CapySession` interface, stream event types, content block types, system prompt template, context builder. Depends on core for types. See `INTELLIGENCE.md`.

**`@capybudget/app`** — all React components (budget UI, capy overlay, shadcn primitives), TanStack Query/Router hooks, Zustand stores, routes, context providers for dependency injection. Depends on core, persistence, intelligence.

**`@capybudget/mcp`** — standalone MCP server with data and render tools. Depends on core and persistence. See `INTELLIGENCE.md`.

## Import Convention

- `@capybudget/*` for shared packages
- `@/` alias for app-internal imports within `packages/app`
- kebab-case file naming throughout
