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

## Phase 5: Monorepo & Code Sharing ✓

Extract shared logic into packages, decouple from Tauri. See `MONOREPO.md` for architecture.

- [x] **5.1 — Package Extraction**
  - npm workspaces with shared packages (core, persistence, intelligence, app, mcp)
  - Pure business logic in `@capybudget/core`
  - Repository + CSV adapter with FileAdapter interface in `@capybudget/persistence`
  - Session interface + prompt in `@capybudget/intelligence`
  - Full React application in `@capybudget/app`
  - MCP server standalone in `@capybudget/mcp`, reuses core + persistence

- [x] **5.2 — Adapter Pattern**
  - FileAdapter, CapySession, BudgetService interfaces
  - Desktop shell provides Tauri adapters
  - Desktop and demo shells mount the same `@capybudget/app`

---

## Phase 6: Demo & Distribution

- [x] **6.1 — Web Demo**
  - Browser-based demo deployed to Vercel (PR previews + production from main)
  - Three budget presets via in-memory repository
  - Stub intelligence layer (prompts local install for AI features, shows sample render tool output)

---

## Phase 7: Smart Import

Drop a file, intelligence normalizes it, you review and merge.

- [x] **7.1 — File upload**
- [x] **7.2 — Import screen**
- [x] **7.3 — Import tools** — read/write/append for import working directory
- [x] **7.4 — Normalize** — intelligence extracts dropped file into uniform CSV, transfer detection
- [x] **7.5 — Preview area** — editable table, account/category mapping, skip toggles
- [x] **7.6 — Enrich** — merchant matching, auto-categorization, matching tools e.g. `search_merchants`
- [x] **7.7 — Merge** — create entities from mappings, bulk-insert transactions

---

## Phase 8: Analytics

Tab-based analytics dashboard in the Budget section. Six tabs: Spending, Cash Flow, Net Worth, Compare, Merchants, Monthly Budget. Per-tab date controls with period-aware navigation.

- [x] **8.1 — Analytics Layout**
  - Tab bar with six analytics views
  - Per-tab date range state (independent period types and navigation)
  - Category management accessible via settings dialog
  - Period selector pills: Month, Quarter, Year, All Time, Custom (calendar picker)
  - Arrow navigation with data boundary detection

- [x] **8.2 — Expense & Income Breakdown** (Spending tab)
  - Donut chart + category breakdown list with expense/income switcher
  - Distinct color palettes: warm tones for expenses, greens for income
  - Summary strip: total income, total expenses, net

- [x] **8.3 — Net Worth Over Time** (Net Worth tab)
  - Bar chart (theme-colored, red for negative) or smooth area chart (switcher)
  - Monthly granularity, defaults to All Time view

- [x] **8.4 — Cash Flow** (Cash Flow tab)
  - Grouped income vs expense bars per month

- [x] **8.5 — Compare** (Compare tab)
  - User-driven category selection (Cities-Skylines-style checklist) toggling lines on a multi-line chart
  - Categories grouped by `CategoryGroup`, each row shows color swatch + period total
  - Default selection: top 5 by period total; manual selection persists across period navigation
  - Stable per-session color slots so visual identity doesn't shift on toggle

- [x] **8.6 — Merchants** (Merchants tab)
  - Top 15 merchants by spend, horizontal bar chart + ranked list
  - Case-insensitive merchant grouping; transfers and income excluded
- [ ] **8.7 — AI Insights** *(post-Alpha)*
  - Capy builds custom visualizations and analyses on demand
  - Anomaly detection (unusual amounts, spending spikes)

---

## Phase 9: Promo Website ✓

Static marketing site at capybudget.app.

- [x] **9.1 — Astro scaffold** — Astro 6 in `apps/www/`, Tailwind 4, Vercel adapter, Geist font
- [x] **9.2 — Landing page** — hero, feature grid, download/demo/GitHub CTAs
- [x] **9.3 — Privacy policy** — local-first privacy story
- [x] **9.4 — Docs** — MDX content collection with getting-started guide

---

## Phase 10: Road to Alpha

The path from current state to a public, signed, auto-updating Alpha release. Ordered roughly in the sequence of work — features first, then branding/content, then distribution.

### Features

- [x] **10.1 — Net Worth account filter**
  - A cog next to sidebar net worth where user can choose accounts to *exclude* from Net Worth
  - Any new accounts are included by default
  - Persists via repo.
  - Sidebar net worth and Net Worth analytics tab both honor the flag

- [ ] **10.2 — Monthly Budget tab**
  - **Tracking model.** `assigned` field on the Category (integer cents | null). `null` (empty CSV cell) = untracked. Any number, including `0`, = tracked at that monthly amount. The act of assigning *is* the act of opting a category into tracking — there is no second flag. Assigned is a single piece of mutable current-state: changing Rent from `350000` to `400000` updates every past, current, and future month at once. No per-month history.
  - **Schema bump v2 → v3.** Add `assigned` column to `categories.csv`. Forward-compatible CSV parse (missing column → `null`), matching the v1 → v2 pattern. Update DATA_MODEL.md migration history.
  - **Period.** Month only — Quarter/Year/All Time/Custom do not apply. `< March 2026 >` arrow nav. The pill cluster still renders on the right with a single, always-active `Month` pill so the date row matches the layout of every other tab.
  - **Layout.** Rows grouped by `CategoryGroup` (matching the rest of the app), with per-group subtotals computed from tracked rows only. **Income group is excluded from this tab entirely** — budgeting earns vs. expected income is a different mental model and out of scope here.
  - **Top KPI strip (4 cards).** Assigned (sum of tracked assigned), Spent (tracked) (sum spent in tracked categories this month), Remaining (assigned − tracked spent), Other Spending (sum spent in untracked, non-Income categories this month — the "what you might be missing" number).
  - **Filter toggle.** "Display only tracked categories" — pure visual filter, doesn't change tracked state. Label shows count, e.g. "8 of 14 tracked".
  - **Per-row layout.** `[color dot] Category | [Assigned input] | Spent | Progress bar | Remaining`. Inline edit on the assigned input writes through the category repo. Empty input ⇒ untracked (null); `0` ⇒ tracked at zero (any spend is over).
  - **Untracked row styling.** Dimmed text, "not tracked" placeholder in the progress column, em-dash in remaining. Still visible (unless filtered) so the user has one click to opt in.
  - **Progress bar states.** Green (well under), gold (close — e.g. ≥80% of assigned), red with overshoot tail (over). For a tracked-at-zero category, any spend renders red.

- [ ] **10.3 — First-run experience**
  - On first launch: prompt to create or select a budget
  - No empty/broken initial state

- [ ] **10.4 — Budget selector polish**
  - Recent budgets in a scrollable area (no full-app scroll with 3+ budgets)
  - Prune missing paths from recents automatically
  - Fix "Reveal in Finder" action

- [x] **10.5a — Provider adapters** (Phase A + Phase B)
  - Pluggable intelligence layer with three providers: Claude Code CLI, Anthropic API, OpenAI API
  - In-process tool dispatch for API adapters; MCP server kept for external agents
  - `/settings` route + provider radio + per-provider config + connection test
  - Imports work end-to-end on every provider (multimodal images / PDFs in the initial message)

- [ ] **10.5b — Intelligence layer hardening**
  - Review and tighten Capy instructions
  - Make specs available to Capy (so it can troubleshoot — e.g. recommend cleaning `.capy/import` on import issues)
  - Recommend archive over delete for accounts/categories
  - Recommend new budget folder over reset
  - Route big-file uploads to the import page instead of inline

- [ ] **10.6 — Import polish**
  - Guidance for breaking up huge imports
  - More contrast on the import page
  - Nicer merge flow: progress bar, page-switching allowed during merge, ensure import directory cleans up

- [ ] **10.7 — Auto backups**
  - Dated zip files (`yyyy-mm-dd-budget_name.zip`)
  - Rotation: keep 5 recent + 1 per month (last of month) preserved forever

- [ ] **10.8 — Error state hardening**
  - Mid-run file deletion recovery
  - JS crash recovery

- [ ] **10.9 — UI polish pass**
  - Fix transactions scrollbar (handle too small / hides behind header on long lists)
  - Bulk-delete progress bar (50+ records)
  - Cmd-key shortcut overlay (rail nav, transaction, intelligence, budget tabs)
  - Router back/forward navigation controls
  - Right-click context menus (accounts, transactions)
  - Undo/Redo decision: remove or surface (and decide on import undo/redo)

### Branding & content

- [ ] **10.10 — Capy mascot & "Alpha" labeling**
  - Mascot art in app and on promo site
  - "Alpha" indicator visible in app
  - App icon

- [ ] **10.11 — Demo refresh**
  - Surface analytics in demo presets
  - Anchor demo dates to current date

- [ ] **10.12 — Promo site polish**
  - Mascot integrated
  - "Alpha" tag on site
  - "How to start your budget" getting-started content
  - Install instructions

### Distribution

- [ ] **10.13 — DMG: sign, notarize, package**
  - Apple Developer cert + notarization workflow
  - Test installed app on a clean Mac

- [ ] **10.14 — Auto-updater**
  - Tauri updater wired up
  - Signing key for update artifacts
  - Update channel served from GitHub Releases
  - Must ship with v1 — users on the first DMG will get future updates automatically

- [ ] **10.15 — Launch**
  - Cut `v1.0.0-alpha` release
  - Publish DMG to GitHub Releases
  - Promo site live with download link
