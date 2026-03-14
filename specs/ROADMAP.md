# Implementation Roadmap

## Phase 1: UI Shell with Mock Data ✓

Scaffold all screens, nail the layout and navigation. Everything renders from hardcoded mock data.

- [x] **1.1 — Budget Layout & Sidebar**
  - Budget layout route with sidebar + main content area
  - Sidebar: account list grouped by type (Cash, Checking, Savings, Credit, etc.)
  - Each account shows name + derived balance
  - Group subtotals, net worth at top
  - "All Accounts" nav item
  - Responsive collapse behavior

- [x] **1.2 — Transaction List View**
  - Table with columns: date, account, category, merchant, amount
  - Tabular-nums typography for money alignment
  - Signed amount coloring (red expense, green income, neutral transfer)
  - Transfer rows show "from → to" instead of category/merchant
  - "All Accounts" vs single-account filtering
  - Empty state when no transactions

- [x] **1.3 — Account Management UI**
  - Add Account dialog (name, type, opening balance)
  - Account detail view (header + filtered transactions)
  - Edit/archive/delete account actions
  - Sidebar highlights active account

- [x] **1.4 — Category Management**
  - Categories settings panel (groups → categories tree)
  - Add/rename/reorder categories and groups
  - Archive category
  - Default categories visible on first load

- [x] **1.5 — Theme Toggle**
  - Three-state cycle: light → dark → system
  - Sun/moon/auto icon toggle

- [x] **1.6 — Architecture Foundation**
  - Repository pattern (`BudgetRepository` interface + mock adapter)
  - TanStack Query data hooks (`useAccounts`, `useCategories`, `useTransactions`)
  - Mutation hooks with optimistic cache updates
  - Decomposed `budget.tsx` → `BudgetShell` + `BudgetUIContext`
  - Transaction filtering (search, category, date range) wired to UI
  - Shared `TransactionView` component (DRYed route views)
  - Unified default categories (single source of truth)

---

## Phase 2: Data Layer & CRUD ✓

Replace mock data with real CSV I/O. Every mutation writes through.

- [x] **2.1 — CSV Service Layer**
  - Generic CSV read/write service (PapaParse + file adapter)
  - Atomic writes (temp file → rename)
  - Debounced flush strategy

- [x] **2.2 — TanStack Query Integration**
  - Query hooks: `useAccounts()`, `useCategories()`, `useTransactions()`
  - Derived queries: `useAccountBalance(id)`, `useNetWorth()`
  - Query invalidation on mutations

- [x] **2.3 — Account CRUD**
  - Create account → writes accounts.csv + opening balance transaction
  - Edit account name/type
  - Archive (blocked if balance non-zero)
  - Delete (blocked if has transactions beyond opening balance)

- [x] **2.4 — Transaction CRUD**
  - Create/edit/delete expense and income
  - Transfer creation (two linked legs)
  - Transfer delete cascades
  - Category clearing on category delete
  - Optimistic updates in query cache

- [x] **2.5 — Category CRUD**
  - Create/rename/reorder categories and groups
  - Archive/delete with referential integrity

- [x] **2.6 — Undo/Redo**
  - Session-scoped state snapshot stack
  - Zustand store for past/present/future
  - Ctrl+Z / Ctrl+Shift+Z

---

## Phase 3: Data Entry & Search ✓

Fast entry, filtering, bulk operations.

- [x] **3.1 — Transaction Entry Form**
  - Hero amount input with large text
  - Segmented type control (expense/income/transfer) with semantic colors
  - `-` / `+` shortcuts in amount field
  - Date picker with convenient defaults (today)
  - Pre-select currently viewed account
  - Keyboard-first flow (Tab through fields, Enter to save)

- [x] **3.2 — Inline Editing**
  - Click-to-edit cells in transaction list
  - Tab between editable cells
  - Escape to cancel, Enter to confirm

- [x] **3.3 — Search & Filtering**
  - Full-text search across all visible fields
  - Money search ("12.50" finds amount=1250)
  - Category filter dropdown
  - Date range picker
  - Clear filters / active filter indicators

- [x] **3.4 — Sorting**
  - Click column headers to sort
  - Multi-column sort support
  - Persist sort preference per view

- [x] **3.5 — Transaction Multi-Select & Bulk Actions**
  - Checkbox column with select-all and shift-click range selection
  - Floating bulk action bar (categorize, delete, move account, change date, change merchant)
  - All bulk operations integrate with undo/redo

- [x] **3.6 — Merchant Autocomplete & Auto-Categorization**
  - Typeahead suggestions from past merchants (word-start priority, then substring)
  - Selecting a known merchant auto-fills category from most recent matching transaction
  - Works in both transaction form and inline table editing

---

## Phase 4: Intelligence MVP ✓

Capy — an AI assistant with streaming responses, tool-based domain access, and rich content. See `INTELLIGENCE.md` for architecture.

- [x] **4.1 — Overlay UI**
  - Full-viewport overlay with blurred backdrop
  - Chat message list with user/assistant bubbles
  - Input area with Enter to send, Shift+Enter for newline
  - Command picker with prompt templates
  - Rich content blocks: text, tables, bar charts, donut charts

- [x] **4.2 — Claude CLI Integration**
  - Spawn `claude` CLI as long-lived subprocess via Tauri shell plugin
  - JSON streaming I/O (stream-json protocol)
  - Session management (session ID per spawn, lazy respawn on death)
  - Stream parsing: text deltas, tool calls, completion, errors
  - Context enrichment (budget name, date with each message)

- [x] **4.3 — MCP Server**
  - TypeScript MCP server exposing domain data as tools
  - Tools: transactions, accounts, categories, spending summary
  - Render tools for structured output (table, bar chart, donut chart)

- [x] **4.4 — Rich Content Blocks**
  - Structured output parsing from Claude → typed content blocks
  - BlockRenderer routing to specialized renderers
  - Charts and visualizations rendered from structured data

---

## Phase 5: Monorepo & Code Sharing

Extract shared logic into packages, decouple from Tauri. See `MONOREPO.md` for target architecture, `REFACTOR.md` for implementation guide.

- [ ] **5.1 — Package Extraction**
  - npm workspaces with shared packages (core, persistence, intelligence, app, mcp)
  - Pure business logic in `@capybudget/core`
  - Repository + CSV adapter with FileAdapter interface in `@capybudget/persistence`
  - Session interface + prompt in `@capybudget/intelligence`
  - Full React application in `@capybudget/app`
  - MCP server standalone in `@capybudget/mcp`, reuses core + persistence

- [ ] **5.2 — Adapter Pattern**
  - FileAdapter, CapySession, BudgetService interfaces
  - Desktop shell provides Tauri adapters
  - Desktop and demo shells mount the same `@capybudget/app`

---

## Phase 6: Demo & Distribution

- [ ] **6.1 — Web Demo**
  - Browser-based demo deployed to GitHub Pages
  - Preset budget data via in-memory repository
  - Stub intelligence layer (prompts local install for AI features, shows sample render tool output)
  - deploy on a PR for testing

---

## Phase 7: Smart Import

Paste or drop bank data, Claude parses it, you review and confirm.

- [ ] **7.1 — CSV Import**
  - Drop bank-exported CSV
  - Claude maps varied bank formats into internal transaction schema and saves to a file, ready to pass to the app
    - ensure idempotency
    - transfers will be especially tricky
  - When file is ready, display a button in the chat to preview the data

- [ ] **7.2 — Preview Area**
  - preview area is an independent front-end module that operates on the normalized import file
  - provides table with transactions data using same UX as the main transactions table
  - user can edit information and changes will be saved to the file
  - has a button to confirm import of transactions that will store information from the file in our database

- [ ] **7.3 — Other formats**
- [ ] Screenshot Import
- [ ] PDF Import

---

## Phase 8: Analytics & Budgeting

- [ ] **8.1 — Analytics**
  - Spending breakdowns by month, year, custom date range
  - Category trends over time

- [ ] **8.2 — AI Insights**
  - Capy builds custom visualizations and analyses on demand
  - Anomaly detection (unusual amounts, spending spikes)

- [ ] **8.3 — Budget**
  - Assign monthly amounts per category
  - Assigned vs. spent tracking

## Phase 9: Promo website
