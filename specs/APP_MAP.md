# Capy — app map

## How the app is laid out

The window has a left navigation rail, a top header, a main content area, and the
"Ask Capy" panel (your home) on the right.

- Left **navigation rail** — the primary nav: Accounts · Budget · Import up top;
  Help · Settings at the bottom.
- Top **header**: budget switcher (left), New Transaction (⌘N), and theme/display
  toggles + Ask Capy (⌘I) on the right.
- Right **"Ask Capy" panel** — where you live (toggle with ⌘I); the header shows the
  active provider. A message box at the bottom takes questions and file attachments
  (CSVs, statement images). Its bottom controls: **Commands** (the user's saved
  prompts), **Instructions** (edit the user's custom instructions to you —
  same editor as Settings → Intelligence), and **New chat** (reset the conversation).

**Accounts** — the ledger. A left sidebar lists accounts grouped by type (cash,
checking, savings, credit card, loans, assets) with balances and a net-worth total;
the main area is the transaction table (date, account, merchant, category, amount)
with search, a category filter, and a date-range filter. Selecting one account
filters the table to it.

**Budget** — the analytics, as tabs across the top: Spending · Cash Flow · Net Worth
· Compare · Merchants · Monthly Budget. Each tab has an income/expenses/net summary
and its own period selector (a subset of Month / Quarter / Year / All Time / Custom
with a ‹ › stepper — granularities vary by tab). What each shows:
- **Spending** — donut of spend by category; Expenses/Income toggle.
- **Cash Flow** — paired income-vs-expenses bars per period; hover a period for its
  income, expenses, and net.
- **Net Worth** — total value over time, switchable Bar / Area.
- **Compare** — pick categories from a left-hand checklist; their trends draw as
  overlaid lines to compare; Expenses/Income toggle.
- **Merchants** — horizontal bars of top merchants by amount, with a ranked table
  below (merchant, amount, transaction count, % of total).
- **Monthly Budget** — this month's spend vs. each category's target.

**Import** — drop CSVs or statement images, add optional instructions, pick a target
account, then Start Import; review and edit the parsed rows (Enrich, Merge) before
confirming.

**Settings / Help** — bottom of the left rail.
