# Changelog

## 0.7.0 — 2026-03-13

Capy intelligence layer — AI assistant powered by Claude Code CLI.

- Full-viewport chat overlay with rich content rendering (donut charts, bar charts, data tables)
- Glowing Capy button in topbar with brand-aware pulse animation
- Command picker for prompt templates
- Claude CLI integration: long-lived subprocess via Tauri shell plugin, stream-json I/O, session management with auto-restart on crash
- MCP server exposing budget data as structured tools (accounts, transactions, categories, spending summary)
- Tool-based rendering: Claude emits charts and tables via render tools, frontend intercepts and displays them as rich blocks
- System prompt with financial assistant personality, context enrichment per message
- "New Chat" to reset session, empty state, streaming indicator

## 0.6.0 — 2026-03-12

Merchant autocomplete and auto-categorization.

- Merchant typeahead in transaction form and inline editing — suggests past merchants with word-start priority
- Auto-categorization: selecting a known merchant fills the category from the most recent matching transaction

## 0.5.0 — 2026-03-12

Transaction multi-select and bulk actions.

- Checkbox column with select-all (indeterminate state) and shift-click range selection
- Floating bulk action bar: shows count + sum of selected transactions
- Bulk categorize with mixed-category indicator
- Bulk delete with confirmation dialog
- Bulk move to account, change date, change merchant via overflow menu
- All bulk operations integrate with undo/redo
- Note indicator dot click opens edit form for quick note access


## 0.4.0 — 2026-03-11

Data entry, inline editing, search & sort.

- Inline editing: click any cell (date, account, category, merchant, amount) to edit in-place
- Calendar popover for inline date editing
- Account/category selectors open immediately in inline edit mode
- Sortable column headers with per-view sort persistence (Zustand)
- Full-text search across all visible fields including money amounts ("12.50" finds 1250 cents)
- Category filter dropdown and date range picker in toolbar
- Clear filters button with active filter indicators
- Compact amount input that skips save when value unchanged


## 0.3.0 — 2026-03-10

CSV persistence, full CRUD, undo/redo.

- CSV persistence layer: generic read/write with atomic writes (temp→rename) and debounced flush
- CsvRepository replacing MockRepository — data survives app restarts
- Account CRUD: create with opening balance, edit name/type, archive (blocked if balance non-zero), delete (blocked if has transactions), drag-and-drop reorder
- Category CRUD: create, rename, archive/unarchive, delete (clears transaction refs), drag-and-drop reorder with cross-group moves
- Transaction CRUD wired to CSV persistence with optimistic cache updates
- Derived queries: useAccountBalance, useNetWorth via TanStack Query select
- Undo/redo: session-scoped 50-snapshot stack with Cmd+Z / Cmd+Shift+Z
- "New Transaction" redirects to "Add Account" when no accounts exist
- Enter-to-submit in Add Account dialog
- Selected account type uses brand color for better visibility
- Query error surface: toast notifications on data fetch failures
- Inline validation for transfer account selectors


## 0.2.0 — 2026-03-09

UI shell with mock data: accounts, transactions, categories.

- Sidebar with account groups, drag-and-drop reorder, net worth display
- Transaction list with date, merchant, category, and amount columns
- Slide-down transaction form (Cmd+N) with expense/income/transfer modes
- Transfer pair support: linked from/to transactions
- Transaction editing and deletion with confirmation dialog
- Search toolbar with category filter and date range picker
- Account detail view with per-account transaction list and balance
- Category management panel grouped by category type
- Add Account dialog with name, type, and opening balance fields
- Color theme switcher (Capybara, Ocean, Forest, Rose, Slate) with dark mode
- CI workflow for PR validation

## 0.1.0 — 2026-03-07

Initial shell app with full tech stack.

- Tauri v2 desktop shell (macOS) with fs, dialog, and shell plugins
- React 19 + TypeScript + Vite 7 + Tailwind CSS v4 + shadcn/ui
- TanStack Router (file-based), TanStack Query, Zustand
- Budget selector: pick a folder to open or create a budget
- Recent budgets persisted to localStorage, shown on launch
- Budget detection (`budget.json`) and bootstrap (default categories, empty CSVs)
- Placeholder budget workspace route, ready for budget management UI
- Dark mode via system preference
- Spec docs: ARCHITECTURE.md, PRODUCT.md, DATA_MODEL.md
