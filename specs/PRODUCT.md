# Product Vision

**Capy Budget** is a self-contained desktop app for tracking personal finances across every account you own — wallet, checking, savings, crypto, gold pile.

## Philosophy

- **No cloud, no subscription.** Your data lives in plain CSV files in a folder you choose.
- **No opinionated methodology.** The app tracks what happened — you decide how to budget.
- **Budgets handle themselves.** Targets derive from your own spending history, so a budget exists from day one with nothing to assign. Setting an explicit number is a quality-of-life override, not a mandatory grind.
- **Sync for free.** Point the data folder at iCloud or Dropbox and get cross-device sync without a backend.
- **Self-describing data.** Metadata lives alongside data files. Copy a folder to another machine and it just works.
- **Intelligence is optional.** An optional layer (Capy) adds smart import, auto-categorization, and natural language insights — pluggable across Claude Code CLI, Anthropic API, OpenAI API, and a local Ollama server. The app is fully functional without it.

## Core Principle

Every feature derives from a simple, well-maintained transaction database. The complexity of maintaining that database is where intelligence makes the difference.

## Key Features

### Accounts

Accounts represent financial entities: bank accounts, wallets, credit cards, loans, investments. See DATA_MODEL.md for types, schemas, and integrity rules.

Balances are always derived from transactions — never stored. Net worth is the sum of all non-archived account balances (assets positive, liabilities negative).

Accounts can be archived (zero balance required) or deleted (only if no real transaction history).

### Multi-currency

Each account holds one currency, chosen at creation and locked once it has transactions (re-denominating historical amounts is meaningless — make a new account instead). The budget has a default currency that every roll-up reports in; an account left unspecified takes that default.

Money is stored native and never re-rated. Conversion happens only at read time, with two rates for two questions: **flows** — what was spent or earned — are valued at the rate stamped on the day each transaction happened, so history never moves as rates drift; **holdings** — what an account is worth now — are valued at today's rate. Rates resolve per currency from a manual override, else a bundled rate table, else 1.0. Cross-currency transfers carry a second amount field — one per leg — so moving money between currencies records the real rate on both sides.

The two rates don't reconcile, and the gap is real: a foreign balance's spot value (today's rate) minus its cost value (stamped flows) is unrealized FX gain or loss, surfaced as a **net-worth FX delta** rather than hidden. A single-currency budget has every rate at 1.0, so conversion is the identity and none of the multi-currency surfaces appear — no per-currency settings, no FX line, no extra transfer field.

Per-row amounts render in each account's own currency — the native truth of the row — so a foreign transaction shows under its own symbol, never the default's. A single account's page leads with its native balance in its own currency; for a foreign account it also shows the default-currency equivalent at today's rate as a secondary line. Aggregates across accounts (net worth, category and cash-flow roll-ups) report in the default.

### Transactions

Three types: expense, income, and transfer. Amounts are signed (negative = outflow, positive = inflow) with semantic coloring in the UI.

**Credit card lifecycle**
1. **Purchase**: expense on the credit card. Balance goes more negative. Category impacted now.
2. **Payment**: transfer from checking to credit card. No category impact. The payment is debt settlement, not spending.

### Categories

Fully user-manageable with sensible defaults. Organized into groups that provide financial reasoning: Fixed (hard to change), Daily Living & Personal (where to cut first), Irregular (easy to forget). Users can create, rename, and reorder both categories and groups.

By default transaction category is null, in the UI this surfaces as 'Uncategorized' and I should be able to reset category value back to null, choosing 'Uncategorized'.

### Monthly Budget

Every category budgets itself. The Monthly Budget tab tracks this month's spend per category against a target — and that target is set for you, derived from the category's own history (the heavier of last month and a reference average of its active months). Spending alone produces a useful budget: open the tab and every category already has a target and a live progress bar, with no number to assign.

You choose what "normal" the reference measures against. A dropdown on the bar legend sets the **comparison basis** for the whole budget: your recent rhythm over the last 3, 6, or 12 months, or — for categories with a yearly shape like Travel or gifts — the same month a year ago, so a seasonal target compares against the season rather than the quiet months either side of it. Switch it and every target re-derives at once. The default is the trailing three months.

An explicit budget is an optional override, not a prerequisite. Set one on any category to track against your own figure instead of the inferred one; the rest keep budgeting themselves. A category with no recent spending stays calm and untargeted rather than guessing. Budgets self-tune as spending shifts, so the tab keeps reflecting how money actually moves without periodic upkeep.

### Sidebar

Accounts grouped by type: Cash, Checking, Savings, Credit, Investment, Loans, Archived. Each group shows a subtotal; each account shows its live derived balance.

### Intelligence Layer (Capy)

- **Chat panel** — right-edge slide-out with conversation, tool activity, charts, and follow-up suggestions. See `FRONTEND_DESIGN.md` for the interaction model.
- **Smart import** — paste a bank screenshot or CSV, Capy parses it, you review and confirm.
- **Auto-categorization** — learns from existing spending patterns.
- **Insights** — natural language queries about spending.
- **Anomaly detection** — flags unusual transactions or spending spikes.

## UX & Visual Design

See `FRONTEND_DESIGN.md` for interaction patterns, color scheme, typography, and accessibility guidelines.
