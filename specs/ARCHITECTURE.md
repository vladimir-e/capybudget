# Architecture

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Monorepo | npm workspaces | Package management, dependency hoisting |
| Desktop shell | Tauri v2 | Lightweight native wrapper (~15 lines Rust) |
| Frontend | React 19 + TypeScript | UI components and application logic |
| Bundler | Vite 7 | Dev server and production builds |
| Routing | TanStack Router | Type-safe file-based routing |
| Data cache | TanStack Query 5 | Async cache with fetch, invalidate, loading states |
| App state | Zustand 5 | Lightweight stores (app state, undo/redo) |
| UI primitives | shadcn/ui (Radix) | Accessible components, owned by the project |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| CSV | PapaParse | Parse/unparse CSV with type coercion |

### Tauri Plugins (Desktop Shell)

| Need | Plugin |
|---|---|
| File read/write | `@tauri-apps/plugin-fs` |
| Folder picker | `@tauri-apps/plugin-dialog` |
| Spawn Claude CLI | `@tauri-apps/plugin-shell` |

## Principles

### All Logic in TypeScript

Rust is only used for Tauri plugin registration. All application logic — data parsing, validation, queries, UI — lives in TypeScript.

### Functional Style

- Pure functions for data transformations
- Immutable data structures
- Side effects isolated to adapter boundaries
- Composable utilities over class hierarchies

### Single Responsibility

- A **service** (core) contains pure data transformations — no I/O
- A **repository** (persistence) handles storage — doesn't know about UI
- A **hook** (app) bridges data to React — no business logic
- A **component** (app) displays data — no file I/O
- The **intelligence layer** produces structured data — the app validates and writes

### Monorepo

See `MONOREPO.md` for package layout, dependency graph, and adapter pattern.

## Data Flow

```
User picks folder (or demo loads preset data)
  → BudgetService adapter detects/bootstraps budget
  → CsvRepository reads CSVs via FileAdapter
  → PapaParse with typed coercion → domain objects
  → TanStack Query cache
  → UI reads via query hooks
  → mutations apply pure service functions from @capybudget/core
  → optimistic cache update → repo.save*()
```

## Mutation Strategy

### Optimistic Updates

1. Validate locally. If invalid, show inline error immediately.
2. Apply pure service function from `@capybudget/core`.
3. Update TanStack Query cache immediately.
4. Persist via repository in the background (debounced).
5. On write failure: show blocking error. No retry, no partial rollback.

### Undo / Redo

Session-scoped stack of state snapshots (past, present, future). Mutations push present to past. Undo pops past and triggers repository write to re-sync. Not persisted across sessions.

### Write Safety

- Atomic writes (temp file → rename)
- Debounced flush (rapid mutations batched)

## Routing

TanStack Router with file-based routing. Routes live in `packages/app/src/routes/`.

- `/` — Budget selector
- `/budget?path=...&name=...` — Budget workspace

## State Management

| Concern | Solution | Persistence |
|---|---|---|
| Budget data | TanStack Query | Repository adapter |
| Recent budgets | Zustand | localStorage |
| Undo/redo | Zustand | None (session only) |
| UI state | BudgetUIContext | None (ephemeral) |

## Intelligence

See `INTELLIGENCE.md` for the full intelligence layer architecture.

## Testing

See `TESTING.md` for testing strategy and infrastructure.

## Conventions

### File Naming

kebab-case for all files (e.g. `budget-shell.tsx`, `csv-repository.ts`).

### Imports

- `@capybudget/*` for shared packages
- `@/` alias for app-internal imports within `packages/app`

### Components

- Functional components only
- Co-locate component logic in the same file
- Extract when reused or > ~150 lines
- shadcn components in `components/ui/`, customized freely
