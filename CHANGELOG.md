# Changelog

## 0.5.0 — 2026-03-12

Transaction multi-select and bulk actions.

### Added
- Checkbox column with select-all (indeterminate state) and shift-click range selection
- Floating bulk action bar: shows count + sum of selected transactions
- Bulk categorize with mixed-category indicator
- Bulk delete with confirmation dialog
- Bulk move to account, change date, change merchant via overflow menu
- All bulk operations integrate with undo/redo
- Note indicator dot click opens edit form for quick note access

### Changed
- Note indicator dots aligned to right edge of merchant column (no longer diagonal)
- Enlarged note indicator hover target for easier tooltip access
- Bulk value changes (categorize, move, date, merchant) preserve selection; only delete clears it
- Text selection prevented during shift-click in transaction table

## 0.4.0 — 2026-03-11

Data entry, inline editing, search & sort.

### Added
- Inline editing: click any cell (date, account, category, merchant, amount) to edit in-place
- Calendar popover for inline date editing
- Account/category selectors open immediately in inline edit mode
- Sortable column headers with per-view sort persistence (Zustand)
- Full-text search across all visible fields including money amounts ("12.50" finds 1250 cents)
- Category filter dropdown and date range picker in toolbar
- Clear filters button with active filter indicators
- Compact amount input that skips save when value unchanged

### Fixed
- Inline edit cells no longer get stuck after save (click propagation fix)
- Selector dropdowns (account/category) no longer stay stuck in edit mode after value selection
- Dismiss (click-away) on selectors correctly cancels editing
- Transaction form datetime timezone handling on edit
- Archived account views are read-only (no editing, no "New Transaction")

### Changed
- Extracted inline edit cells to dedicated module (`inline-edit-cells.tsx`)
- Introduced `useBudgetMutation` factory — all 16 mutation hooks reduced to pure transform logic
- Removed `deleteTransaction` from BudgetUIContext — context is now pure UI state
- Deleted `use-mutation-deps.ts` (absorbed into mutation factory)

## 0.3.0 — 2026-03-10

CSV persistence, full CRUD, undo/redo.

### Added
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

### Fixed
- Account deletion no longer wipes all transactions — correctly blocked when >1 transaction exists, cleans up only the opening balance transaction
- Opening balance transactions consistently use empty categoryId (was inconsistent in mock data)
- Date picker keyboard selection (Enter/Space) now works correctly
- Transaction form resets on cancel

## 0.2.0 — 2026-03-09

UI shell with mock data: accounts, transactions, categories.

### Added
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
