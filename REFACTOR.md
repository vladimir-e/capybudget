# Monorepo Extraction — Implementation Guide

> Throw-away document. Delete after the extraction is complete.

## Context

The codebase started as a single Tauri + React app. The intelligence layer introduced an MCP server (`mcp/server.ts`) that duplicated types, CSV parsing, money formatting, and account balance calculation because it runs as a standalone Node process outside Vite. A web demo deployment requires the same React UI with different adapters. This motivates extracting shared code into packages.

## Current Duplication (MCP vs App)

| What | App location | MCP server | Notes |
|---|---|---|---|
| Types (Account, Category, Transaction) | `src/lib/types.ts` | `mcp/server.ts` L20-48 | MCP uses plain `string` instead of union types |
| CSV reading + coercion maps | `src/services/csv.ts` | `mcp/server.ts` L50-89 | App: Tauri async. MCP: Node sync. Same PapaParse logic |
| `formatMoney()` | `src/lib/money.ts` | `mcp/server.ts` L93-99 | Identical |
| `accountBalance()` | `src/hooks/use-derived-queries.ts` | `mcp/server.ts` L101-105 | Identical |

## Pure TypeScript Files (no Tauri dependency)

These move to `packages/core` without modification:
- `src/lib/types.ts` — domain types and union types
- `src/lib/money.ts` — formatMoney, parseMoney, formatMoneyCompact, getAmountClass
- `src/services/accounts.ts` — pure account mutation functions + AccountFormData
- `src/services/categories.ts` — pure category mutation functions + CategoryFormData
- `src/services/transactions.ts` — pure transaction mutation functions + TransactionFormData
- `src/services/bulk-transactions.ts` — bulk operations (delete, assign category, move account, etc.)
- `src/services/merchant-categorization.ts` — merchant matching + auto-categorization

## Files That Need Splitting

**`src/services/csv.ts`** → split into:
- PapaParse parsing + coercion maps + toBool/toInt helpers → `packages/persistence/src/csv-parse.ts`
- Debounced writer → `packages/persistence/src/debounced-writer.ts`
- Tauri file I/O (readTextFile, writeTextFile, rename) → extracted into `src/adapters/tauri-file-adapter.ts`

**`src/services/capy-stream.ts`** → split into:
- Stream event types + content block types → `packages/intelligence/src/types.ts`
- CLI-specific JSON parsing logic → stays in desktop shell

**`src/repositories/csv-repository.ts`** → refactored:
- Moves to `packages/persistence/src/csv-repository.ts`
- Takes a `FileAdapter` instead of directly calling Tauri fs
- Uses csv-parse from the same package

## Files That Move to packages/intelligence

- `src/services/capy-prompt.ts` → `packages/intelligence/src/prompt.ts` (system prompt + context builder)
- Stream event types from `src/services/capy-stream.ts` → `packages/intelligence/src/types.ts`
- New: `packages/intelligence/src/session.ts` — CapySession interface definition

## Files That Stay in Desktop Shell (src/)

- `src/services/capy-session.ts` → `src/adapters/claude-cli-session.ts` (implements CapySession, Tauri shell-specific)
- `src/services/budget.ts` → `src/adapters/tauri-budget-service.ts` (folder detection/bootstrap, Tauri fs)
- Stream JSON parser from `src/services/capy-stream.ts` → `src/adapters/stream-parser.ts` (CLI output format)
- `src/main.tsx` — thin shell, provides adapters, mounts `<App />`

## Files That Move to packages/app

Everything else in `src/`:
- `src/components/` → `packages/app/src/components/` (all React components including budget UI, capy overlay, shadcn)
- `src/hooks/` → `packages/app/src/hooks/` (all query, mutation, filter, undo hooks)
- `src/stores/` → `packages/app/src/stores/` (undo-store, app-store)
- `src/routes/` → `packages/app/src/routes/` (all route definitions)
- `src/repositories/repository-context.ts` → `packages/app/src/providers/` (React context for DI)
- `src/app.css` and styles → `packages/app/`

## Target Structure

```
capybudget/
├── packages/
│   ├── core/                      # @capybudget/core
│   │   ├── src/
│   │   │   ├── types.ts           # Account, Category, Transaction, unions
│   │   │   ├── money.ts           # formatMoney, parseMoney, getAmountClass
│   │   │   ├── accounts.ts        # pure account mutations + AccountFormData
│   │   │   ├── categories.ts      # pure category mutations + CategoryFormData
│   │   │   ├── transactions.ts    # pure transaction mutations + TransactionFormData
│   │   │   ├── bulk-transactions.ts
│   │   │   ├── merchant.ts        # matching + auto-categorization
│   │   │   └── index.ts           # barrel export
│   │   ├── __tests__/             # tests that moved with the code
│   │   ├── package.json           # deps: papaparse, uuid
│   │   └── tsconfig.json
│   │
│   ├── persistence/               # @capybudget/persistence
│   │   ├── src/
│   │   │   ├── repository.ts      # BudgetRepository interface
│   │   │   ├── file-adapter.ts    # FileAdapter interface
│   │   │   ├── csv-repository.ts  # CsvRepository (lazy cache, debounced writes, FileAdapter)
│   │   │   ├── csv-parse.ts       # PapaParse wrapper + coercion maps
│   │   │   ├── debounced-writer.ts
│   │   │   └── index.ts
│   │   ├── __tests__/
│   │   ├── package.json           # deps: @capybudget/core, papaparse
│   │   └── tsconfig.json
│   │
│   ├── intelligence/              # @capybudget/intelligence
│   │   ├── src/
│   │   │   ├── types.ts           # StreamEvent, ContentBlock, SessionEvent unions
│   │   │   ├── session.ts         # CapySession interface
│   │   │   ├── prompt.ts          # system prompt template, buildContext()
│   │   │   └── index.ts
│   │   ├── package.json           # deps: @capybudget/core
│   │   └── tsconfig.json
│   │
│   ├── app/                       # @capybudget/app
│   │   ├── src/
│   │   │   ├── components/        # ALL React components (budget/, ui/, capy overlay)
│   │   │   ├── hooks/             # ALL hooks (query, mutation, filter, undo, capy)
│   │   │   ├── stores/            # Zustand stores (undo-store, app-store)
│   │   │   ├── routes/            # TanStack Router routes
│   │   │   ├── providers/         # DI context (repository, intelligence, budget service)
│   │   │   ├── styles/            # app.css, Tailwind entry
│   │   │   └── index.ts           # exports <App />, provider types, adapter interfaces
│   │   ├── __tests__/
│   │   ├── package.json           # deps: @capybudget/core, persistence, intelligence + React, TanStack, Zustand, shadcn
│   │   └── tsconfig.json
│   │
│   └── mcp/                       # @capybudget/mcp
│       ├── src/
│       │   ├── server.ts          # entry point, MCP server setup
│       │   ├── data-tools.ts      # list_accounts, list_transactions, etc.
│       │   ├── render-tools.ts    # render_table, render_bar_chart, render_donut_chart
│       │   ├── node-file-adapter.ts # FileAdapter → Node fs/promises
│       │   └── index.ts
│       ├── package.json           # deps: @capybudget/core, persistence, @modelcontextprotocol/sdk
│       └── tsconfig.json
│
├── src/                           # Desktop shell (thin Tauri wrapper)
│   ├── main.tsx                   # mount <App /> with Tauri adapters
│   └── adapters/
│       ├── tauri-file-adapter.ts  # FileAdapter → @tauri-apps/plugin-fs
│       ├── claude-cli-session.ts  # CapySession → Tauri shell + Claude CLI
│       ├── tauri-budget-service.ts # detect/bootstrap via Tauri fs + dialog
│       └── stream-parser.ts       # Claude CLI stream-json → StreamEvent
│
├── apps/
│   └── demo/                      # Web demo shell
│       ├── src/
│       │   ├── main.tsx           # mount <App /> with mock adapters
│       │   └── adapters/
│       │       ├── memory-repository.ts  # BudgetRepository with preset data
│       │       └── stub-session.ts       # "install locally for AI" stub
│       ├── data/                  # preset demo budget (JSON or CSV)
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
├── src-tauri/                     # Rust shell (unchanged)
├── index.html                     # desktop entry point
├── vite.config.ts                 # desktop Vite config
├── package.json                   # workspace root + desktop app deps
├── tsconfig.json                  # base tsconfig
└── specs/
```

## Migration Order

### Step 1: Set up npm workspaces

1. Add `"workspaces"` field to root `package.json`
2. Create each package directory with `package.json` and `tsconfig.json`
3. Run `npm install` to link workspaces
4. Verify the workspace graph resolves

### Step 2: Extract @capybudget/core

Move the pure files:
1. `src/lib/types.ts` → `packages/core/src/types.ts`
2. `src/lib/money.ts` → `packages/core/src/money.ts`
3. `src/services/accounts.ts` → `packages/core/src/accounts.ts`
4. `src/services/categories.ts` → `packages/core/src/categories.ts`
5. `src/services/transactions.ts` → `packages/core/src/transactions.ts`
6. `src/services/bulk-transactions.ts` → `packages/core/src/bulk-transactions.ts`
7. `src/services/merchant-categorization.ts` → `packages/core/src/merchant.ts`
8. Create barrel `packages/core/src/index.ts`
9. Move associated tests
10. Update all imports: `@/lib/types` → `@capybudget/core`, `@/services/accounts` → `@capybudget/core`, etc.

**Checkpoint:** run tests.

### Step 3: Extract @capybudget/persistence

1. `src/repositories/types.ts` → `packages/persistence/src/repository.ts`
2. Create `packages/persistence/src/file-adapter.ts` with FileAdapter interface:
   - `readFile(path: string): Promise<string>`
   - `writeFile(path: string, content: string): Promise<void>`
   - `rename(from: string, to: string): Promise<void>`
   - `join(...parts: string[]): Promise<string>`
3. Extract from `src/services/csv.ts`:
   - PapaParse parsing + coercion maps → `packages/persistence/src/csv-parse.ts`
   - Debounced writer → `packages/persistence/src/debounced-writer.ts`
4. `src/repositories/csv-repository.ts` → `packages/persistence/src/csv-repository.ts`
   - Refactor constructor to accept `FileAdapter`
   - Use csv-parse from the package instead of csv.ts
5. Create `src/adapters/tauri-file-adapter.ts` implementing FileAdapter with Tauri plugin-fs
6. Delete `src/services/csv.ts` (logic distributed to persistence + tauri adapter)
7. Create barrel export
8. Move associated tests

**Checkpoint:** run tests.

### Step 4: Extract @capybudget/intelligence

1. Extract from `src/services/capy-stream.ts`:
   - StreamEvent, ContentBlock type definitions → `packages/intelligence/src/types.ts`
   - Keep CLI-specific parsing in desktop shell
2. Create `packages/intelligence/src/session.ts` — CapySession interface
3. `src/services/capy-prompt.ts` → `packages/intelligence/src/prompt.ts`
4. Refactor `src/services/capy-session.ts` → `src/adapters/claude-cli-session.ts`
   - Implement CapySession interface
   - Keep Tauri shell plugin dependency
5. Move CLI stream parser to `src/adapters/stream-parser.ts`
6. Create barrel export

**Checkpoint:** run tests, verify overlay still streams.

### Step 5: Rebuild @capybudget/mcp

1. Create `packages/mcp/src/node-file-adapter.ts` — FileAdapter using Node fs/promises
2. Rewrite `mcp/server.ts` → `packages/mcp/src/server.ts`:
   - Import types from `@capybudget/core`
   - Import CsvRepository + FileAdapter from `@capybudget/persistence`
   - Remove all duplicated code (types, CSV parsing, formatMoney, accountBalance)
3. Split tool definitions: `data-tools.ts`, `render-tools.ts`
4. Delete old `mcp/` directory
5. Add `bin` entry to package.json for standalone use

**Checkpoint:** test MCP server with `echo '...' | npx tsx packages/mcp/src/server.ts`.

### Step 6: Extract @capybudget/app

This is the biggest move. Everything remaining in `src/` except adapters and main.tsx:

1. `src/components/` → `packages/app/src/components/`
2. `src/hooks/` → `packages/app/src/hooks/`
3. `src/stores/` → `packages/app/src/stores/`
4. `src/routes/` → `packages/app/src/routes/`
5. `src/repositories/repository-context.ts` → `packages/app/src/providers/repository-provider.ts`
6. Create intelligence + budget service providers in `packages/app/src/providers/`
7. Create `packages/app/src/index.ts` exporting `<App />` and provider types
8. `src/app.css` → `packages/app/src/styles/`
9. Reduce `src/main.tsx` to thin shell: import App, provide adapters, mount
10. Move associated tests
11. Update ALL imports (this is the heaviest step)

**Checkpoint:** `npm run tauri dev` — full app should work.

### Step 7: Delete src/lib/

After extraction, `src/lib/` should be empty. Delete it. Any remaining utility should either be in `@capybudget/core` or be app-specific in `packages/app`.

### Step 8: Verification

- [ ] `npm install` succeeds from root (workspaces resolve)
- [ ] `npm test` passes all tests across all packages
- [ ] `npm run tauri dev` launches desktop app, full functionality
- [ ] `npm run build` produces production build
- [ ] MCP server responds to tool calls when run standalone
- [ ] Capy overlay streams responses and renders content blocks
- [ ] Undo/redo works across all CRUD operations
- [ ] All account/category/transaction CRUD persists to CSV

## Pitfalls

### TanStack Router file-based routing
Routes move to `packages/app/src/routes/`. The TanStack Router Vite plugin generates `routeTree.gen.ts` by scanning the filesystem. The desktop Vite config needs `routesDirectory` pointing to the package's routes, or switch to code-based route definitions.

### @/ alias scope
`@/` alias should resolve to `packages/app/src/` (not `src/`). Update `vite.config.ts` and `tsconfig.json` paths. The desktop shell's `src/` files use relative imports or explicit package imports — they don't use `@/`.

### Tailwind content paths
Tailwind scans for class names. Update `content` paths to include `packages/app/src/**/*.{ts,tsx}` so classes used in shared components are included in the build.

### CSS imports
If `packages/app` components import CSS, the consuming shell's Vite config must handle them. Keep Tailwind entry point (app.css with `@import "tailwindcss"`) in the app package.

### Test relocation
Tests co-located with source files move with them. Each package gets its own vitest config extending the root. The root `npm test` runs all packages.

### Package build strategy
Packages don't need a separate build step — Vite/tsx resolve TypeScript directly from source. Each package.json points `main`/`types` to `src/index.ts`. No compilation needed for development.
