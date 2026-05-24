# Product Vision

**Capy Budget** is a self-contained desktop app for tracking personal finances across every account you own — wallet, checking, savings, crypto, gold pile.

## Philosophy

- **No cloud, no subscription.** Your data lives in plain CSV files in a folder you choose.
- **No opinionated methodology.** The app tracks what happened — you decide how to budget.
- **Sync for free.** Point the data folder at iCloud or Dropbox and get cross-device sync without a backend.
- **Self-describing data.** Metadata lives alongside data files. Copy a folder to another machine and it just works.
- **Intelligence is optional.** An optional layer (Capy) adds smart import, auto-categorization, and natural language insights — pluggable across Claude Code CLI, Anthropic API, and OpenAI API. The app is fully functional without it.

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

### Analytics

A tabbed dashboard over the full transaction history. Date-range nav (month / quarter / year / custom / all time) sits above each tab; tabs that don't apply to a given period gray those pills out.

- **Monthly Budget** — per-category targets vs actual spend for the active month. Default tab.
- **Spending** — breakdown by category for the active range, with drill-into-transactions on each row.
- **Cash Flow** — monthly income vs expenses across the range.
- **Net Worth** — net-worth-over-time chart with per-account inclusion toggles.
- **Compare** — category trends across multiple ranges side by side.
- **Merchants** — top merchants by spend for the active range.
- **Patterns** — recurring subscriptions and likely duplicate transactions, both detected over the full window (the tab hides the date-range nav). Each card opens the transaction modal scoped to that pattern or group.

### Intelligence Layer (Capy)

- **Chat panel** — right-edge slide-out with conversation, tool activity, charts, and follow-up suggestions. See `FRONTEND_DESIGN.md` for the interaction model.
- **Smart import** — paste a bank screenshot or CSV, Capy parses it, you review and confirm.
- **Auto-categorization** — learns from existing spending patterns.
- **Insights** — natural language queries about spending.
- **Anomaly detection** — flags unusual transactions or spending spikes.

## UX & Visual Design

See `FRONTEND_DESIGN.md` for interaction patterns, color scheme, typography, and accessibility guidelines.

---

**Maintenance note.** This file is embedded in full into Capy's chat system prompt as the always-on product brief — see `packages/intelligence/src/prompts/chat.ts`. When editing the feature inventory above, the change reaches every chat session on the next prompt build. Make sure additions/removals read well as Capy's working knowledge of what the app can do.
