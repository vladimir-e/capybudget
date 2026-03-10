# Architecture

## Tech Stack

| Layer           | Technology             | Version | Purpose                                     |
|-----------------|------------------------|---------|---------------------------------------------|
| Desktop shell   | Tauri v2               | 2.x     | Lightweight native wrapper, ~15 lines Rust  |
| Frontend        | React + TypeScript     | 19.x    | UI components and application logic         |
| Bundler         | Vite                   | 7.x     | Fast dev server and production builds       |
| Routing         | TanStack Router        | 1.x     | Type-safe file-based routing                |
| Data cache      | TanStack Query         | 5.x     | Async cache for CSV data (fetch, invalidate, loading states) |
| App state       | Zustand                | 5.x     | Lightweight store for app-level state       |
| UI primitives   | shadcn/ui (Radix)      | —       | Accessible components, copied into project  |
| Styling         | Tailwind CSS           | 4.x     | Utility-first CSS, zero-config in v4        |
| CSV             | PapaParse              | 5.x     | Parse/unparse CSV with type coercion        |

### Tauri Plugins

| Need              | Plugin                      |
|-------------------|-----------------------------|
| File read/write   | `@tauri-apps/plugin-fs`     |
| Folder picker     | `@tauri-apps/plugin-dialog` |
| Spawn Claude Code | `@tauri-apps/plugin-shell`  |

## Project Structure

```
capybudget/
├── src-tauri/
│   ├── src/lib.rs              ← Plugin registration only
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── routes/                 ← TanStack Router file-based routes
│   │   ├── __root.tsx          ← Root layout (toaster, providers)
│   │   ├── index.tsx           ← Budget selector (home screen)
│   │   ├── budget.tsx          ← Budget workspace (RepositoryProvider + BudgetShell)
│   │   └── budget/             ← Nested budget routes
│   │       ├── index.tsx       ← All Accounts view
│   │       ├── account.$accountId.tsx ← Single account view
│   │       └── categories.tsx  ← Category management
│   ├── components/
│   │   ├── ui/                 ← shadcn components (owned, not imported)
│   │   └── budget/             ← Budget-specific components
│   │       ├── budget-shell.tsx      ← Layout, form state, keyboard shortcuts
│   │       ├── transaction-view.tsx  ← Shared toolbar + list + delete pattern
│   │       ├── sidebar.tsx           ← Account navigation
│   │       ├── transaction-list.tsx  ← Transaction table
│   │       ├── transaction-form.tsx  ← Add/edit transaction form
│   │       └── ...
│   ├── repositories/           ← Storage adapter pattern
│   │   ├── types.ts            ← BudgetRepository interface
│   │   ├── mock-repository.ts  ← Mock adapter (returns mock data)
│   │   ├── repository-context.ts ← React context for DI
│   │   └── index.ts            ← Barrel export
│   ├── services/
│   │   ├── budget.ts           ← Budget detection, bootstrap, migration
│   │   └── transactions.ts     ← Pure transaction mutation functions
│   ├── stores/
│   │   └── app-store.ts        ← Zustand store (recent budgets, persisted)
│   ├── contexts/
│   │   └── budget-context.tsx   ← BudgetUIContext (UI state only)
│   ├── hooks/
│   │   ├── use-budget-data.ts  ← TanStack Query read hooks
│   │   ├── use-transaction-mutations.ts ← TanStack Query mutation hooks
│   │   └── use-transaction-filters.ts   ← Filter state + memoized filtering
│   ├── lib/
│   │   ├── types.ts            ← Shared TypeScript types
│   │   ├── money.ts            ← Integer math, formatting, parsing
│   │   ├── queries.ts          ← Pure query functions (balance, grouping)
│   │   ├── default-categories.ts ← Single source of truth for category defaults
│   │   ├── filter-transactions.ts ← Pure transaction filtering
│   │   └── utils.ts            ← cn() helper, common utilities
│   ├── main.tsx                ← App entry point
│   └── index.css               ← Tailwind + shadcn theme
├── specs/                      ← Architecture and product documentation
├── components.json             ← shadcn/ui configuration
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Architecture Principles

### All Logic in TypeScript

Rust is only used for Tauri plugin registration (~15 lines). All application logic — data parsing, validation, queries, UI — lives in TypeScript. This keeps the codebase accessible and the iteration cycle fast.

### Data Flow

```
User picks folder
  → detect budget.json or bootstrap new
  → read CSVs via Tauri fs plugin
  → PapaParse into TypeScript objects
  → load into TanStack Query cache
  → UI reads from cache via query hooks
  → mutations update cache optimistically + call repo.save*()
```

### Repository Pattern

Storage is abstracted behind the `BudgetRepository` interface (see `src/repositories/types.ts`). The interface will evolve as new adapters are needed — the current shape is designed for the CSV adapter; future backends (e.g. a database for a web version) may require a different contract.

**Injection:** React context (`RepositoryProvider`) wraps the budget workspace. `useBudgetRepository()` hook provides the active adapter.

### Data Hooks (TanStack Query)

Query hooks (`useAccounts`, `useCategories`, `useTransactions`) wrap repository reads with `staleTime: Infinity`. Mutation hooks apply pure transformations, update the cache optimistically, then persist via the repository.

### Functional Style

- Pure functions for data transformations and queries
- Immutable data structures in the store
- Side effects (file writes, process spawning) isolated to service boundaries
- Composable utilities over class hierarchies

### Single Responsibility

Each module owns one concern:
- A **repository** handles storage I/O — it doesn't know about UI
- A **service** contains pure data transformations — it doesn't do I/O
- A **hook** bridges data to React — it doesn't contain business logic
- A **component** displays data — it doesn't know about file I/O
- The **intelligence layer** produces structured data — the app validates and writes

## Mutation Strategy

### Optimistic Updates

1. Validate locally using shared schema. If invalid, show inline error immediately.
2. Update in-memory state (TanStack Query cache) immediately. UI reflects change instantly.
3. Persist via repository in the background (debounced in CSV adapter).
4. On write failure: show blocking error — "Something went wrong. Reload to continue." No retry logic, no partial rollback. Deliberately blunt because errors are rare in a local-first app.

### Undo / Redo

Session-scoped stack of state snapshots (past, present, future). On mutation: push present to past, replace present with new state. On undo: pop from past, push present to future. Undo triggers the appropriate write to re-sync CSV files. Not persisted across sessions.

### Write Safety

- Mutations write to a temp file first, then atomic rename
- Writes are debounced — rapid changes batched into a single flush

## Routing

TanStack Router with file-based routing. Routes are defined in `src/routes/` and the route tree is auto-generated by the Vite plugin.

Route parameters use type-safe search params:
- `/` — Budget selector
- `/budget?path=...&name=...` — Budget workspace

## State Management

| Concern        | Solution           | Persistence        |
|----------------|---------------------|---------------------|
| Budget data    | TanStack Query      | Repository adapter   |
| Recent budgets | Zustand             | localStorage         |
| Undo/redo      | Zustand             | None (session only)  |
| UI state       | BudgetUIContext     | None (ephemeral)     |

## Intelligence Layer (Future)

Claude Code CLI orchestrated as a subprocess via Tauri's shell plugin. Soft dependency — the app is fully functional without it. Architecture is message-passing: compose prompt with context, shell out to `claude` CLI with streaming, pipe response back to UI.

AI generates structured data. The app validates and writes — AI never has direct storage access.

## Testing & Linting

**Vitest** for unit tests — colocated with source files as `*.test.ts`. Shares `vite.config.ts` so path aliases and transforms work automatically.

**ESLint 9** (flat config) with TypeScript, React Hooks, and React Refresh rules. The `react-refresh/only-export-components` rule is disabled for route files and shadcn components since those patterns require multi-export files.

## Conventions

### File Naming
- Components: `kebab-case.tsx` (e.g. `budget-selector.tsx`)
- Services: `kebab-case.ts` (e.g. `budget.ts`)
- Types: defined in `lib/types.ts`, exported as named types

### Imports
- Use `@/` path alias for all internal imports
- Group imports: React/external → internal → types

### Components
- Functional components only
- Co-locate component-specific logic in the same file
- Extract to separate files when reused or > ~150 lines
- shadcn components live in `components/ui/` and are customized freely
