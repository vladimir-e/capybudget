# Changelog

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
