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

**Credit card lifecycle**
1. **Purchase**: expense on the credit card. Balance goes more negative. Category impacted now.
2. **Payment**: transfer from checking to credit card. No category impact. The payment is debt settlement, not spending.

### Categories

Fully user-manageable with sensible defaults. Organized into groups that provide financial reasoning: Fixed (hard to change), Daily Living & Personal (where to cut first), Irregular (easy to forget). Users can create, rename, and reorder both categories and groups.

By default transaction category is null, in the UI this surfaces as 'Uncategorized' and I should be able to reset category value back to null, choosing 'Uncategorized'.

### Sidebar

Accounts grouped by type: Cash, Checking, Savings, Credit, Investment, Loans, Archived. Each group shows a subtotal; each account shows its live derived balance.

### Intelligence Layer (Claude Code)

- **Smart import** — paste a bank screenshot or CSV, Claude parses it, you review and confirm.
- **Auto-categorization** — learns from existing spending patterns.
- **Insights** — natural language queries about spending.
- **Anomaly detection** — flags unusual transactions or spending spikes.

## UX & Visual Design

See `FRONTEND_DESIGN.md` for interaction patterns, color scheme, typography, and accessibility guidelines.

## Target Platforms

- **Desktop** — macOS first (native .dmg via Tauri). Windows and Linux via Tauri cross-compilation.
- **Web demo** — browser-based demo with preset data, deployed to GitHub Pages. Full UI, no persistence, stub intelligence layer.

## Distribution

Open source, MIT license. Public GitHub repo with architecture docs, web demo, and a standalone MCP server (`@capybudget/mcp`) that works with any MCP-compatible AI agent.
