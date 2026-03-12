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

## Phase 2: Data Layer & CRUD

Replace mock data with real CSV I/O. Every mutation writes through.
Enabled by the repository pattern — create `CsvRepository`, swap in `budget.tsx`.

- [x] **2.1 — CSV Service Layer**
  - Generic CSV read/write service (PapaParse + Tauri fs)
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

## Phase 3: Data Entry & Search

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

---

## Phase 4: Intelligence Layer

Claude Code as optional subprocess.

- [ ] **4.1 — Smart Import**
  - Paste bank CSV or screenshot
  - Claude parses → structured preview
  - User reviews and confirms

- [ ] **4.2 — Auto-Categorization**
  - Learn from existing patterns
  - Suggest categories for uncategorized transactions
  - Batch apply with review

- [ ] **4.3 — Insights & Anomalies**
  - Natural language queries about spending
  - Anomaly detection (unusual amounts, spending spikes)
  - Streaming response UI
