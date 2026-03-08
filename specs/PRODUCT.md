# Product Vision

**Capy Budget** is a self-contained desktop app for tracking personal finances across every account you own — wallet, checking, savings, crypto, gold pile.

## Philosophy

- **No cloud, no subscription.** Your data lives in plain CSV files in a folder you choose.
- **No opinionated methodology.** The app tracks what happened — you decide how to budget.
- **Sync for free.** Point the data folder at iCloud or Dropbox and get cross-device sync without a backend.
- **Self-describing data.** Metadata lives alongside data files. Copy a folder to another machine and it just works.
- **Intelligence is optional.** An optional layer powered by Claude Code adds smart import, auto-categorization, and natural language insights. The app is fully functional without it.

## Core Principle

Every feature derives from a simple, well-maintained transaction database. The complexity of maintaining that database is where intelligence makes the difference.

## Key Features

### Accounts

Accounts represent financial entities: bank accounts, wallets, credit cards, loans, investments. See DATA_MODEL.md for types, schemas, and integrity rules.

Balances are always derived from transactions — never stored. Net worth is the sum of all non-archived account balances (assets positive, liabilities negative).

Accounts can be archived (zero balance required) or deleted (only if no real transaction history).

### Transactions

Three types: expense, income, and transfer. Amounts are signed (negative = outflow, positive = inflow) with semantic coloring in the UI.

**Credit card lifecycle** — the app should explain this to users:
1. **Purchase**: expense on the credit card. Balance goes more negative. Category impacted now.
2. **Payment**: transfer from checking to credit card. No category impact. The payment is debt settlement, not spending.

### Categories

Fully user-manageable with sensible defaults. Organized into groups that provide financial reasoning: Fixed (hard to change), Daily Living & Personal (where to cut first), Irregular (easy to forget). Users can create, rename, and reorder both categories and groups.

### Sidebar

Accounts grouped by type: Cash, Checking, Savings, Credit, Investment, Loans, Archived. Each group shows a subtotal; each account shows its live derived balance.

### Intelligence Layer (Claude Code)

- **Smart import** — paste a bank screenshot or CSV, Claude parses it, you review and confirm.
- **Auto-categorization** — learns from existing spending patterns.
- **Insights** — natural language queries about spending.
- **Anomaly detection** — flags unusual transactions or spending spikes.

## UX Principles

### Transaction Entry

- **Hero amount input**: large text, type-aware coloring (red/green/neutral).
- **Segmented type control** (expense/income/transfer) with semantic colors.
- **Keyboard shortcuts in amount field**: `-` → expense, `+` → income.
- **`Cmd+Enter` submits from any field.**
- **Flexible date input**: shorthand like `2/15`, `15` (current month), `yesterday`, plus calendar picker.
- **Secondary fields collapsed**: payee and note behind a "Details" toggle. Auto-expand when editing a transaction that has them filled.
- **Pre-select the currently viewed account.**

### Transaction List

- Columns: date, account, category, payee/note, amount.
- Sortable by any column. Inline editing — click to edit.
- Full-text search across all visible fields. Category filter, date range picker.
- "All Accounts" view for cross-account overview.

### Confirmation Dialogs

Be explicit about consequences. Warn when deleting a transfer (both legs go), deleting a category (N transactions affected), or explain why an archive is blocked.

### Empty States

Guide the user: prompt to create first account, first transaction, or explain empty filter results. When adding a transaction with no accounts, intercept and trigger account creation.

### Typography

Tabular figures (`font-variant-numeric: tabular-nums`) for all financial amounts. Numbers must align vertically in columns.

### Theme

Light, dark, and system-preference modes. Three-state cycle toggle (sun → moon → auto).

### Accessibility

- 44px minimum touch targets (WCAG 2.5.5).
- No hover-only interactions — everything works on keyboard.
- Active navigation: `aria-current="page"`.
- Icon-only buttons: `aria-label`.
- Semantic color tokens for amounts, not raw color values.

## Target Platform

macOS first (native .dmg via Tauri). Windows and Linux possible via Tauri cross-compilation.

## Distribution

Open source, MIT license. Public GitHub repo with a clean README and architecture docs.
