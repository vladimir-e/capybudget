# Changelog

<!--
CHANGELOG PHILOSOPHY:
- This file is a chronological summary for understanding the app's history at a glance.
- Each version should be ~3-8 short bullet points, one line each, NO sub-bullets.
- Describe WHAT was added, not HOW it works.
- Implementation details belong in specs/. Debugging details are in commits.
- Resist the urge to be thorough here. Thoroughness goes in specs, not changelog.
-->

## Unreleased

- **Help** - In-app user guide at `/budget/help` (rail icon beside Settings): scroll-anchored sidebar, live-demo link, ESC to dismiss; linked from the first-run guide.
- **Onboarding** - First-run guide on the empty all-accounts view: a calm three-step panel (add accounts, log transactions, ask Capy) that tracks live state and disappears once any transaction exists.
- **Analytics** - Shared `EmptyState` component; analytics tabs distinguish a brand-new budget ("useful once you have more data") from an empty period.
- **Web** - User-guide docs page on the promo site (mirrors the in-app Help copy), linked from the footer, the How-to-start section, and beside the hero demo CTA; dropped the stale getting-started install walkthrough.
- **Web** - Vercel Web Analytics (visits only, cookieless) on promo site + demo; demo gains a "Get the desktop app" CTA and a small-screen notice.
- **Settings** - Dedicated budget-scoped Settings screen (⌘,) with Intelligence + Categories sections; chat survives the round-trip; Claude Code model picker; categories moved out of the analytics cog.
- **Demo** - Scenarios seed ~3 years of data anchored to today, so analytics render live; brief seeding screen on entry.
- **Demo** - SPA fallback so deep links no longer 404 at the edge; a hard refresh always lands on scenario selection instead of a regenerated budget (#53).
- **Monthly Budget** - Every category budgets itself from spending history; zoned progress bar with green/red zones, history pins, and auto-vs-explicit targets (#49).
- **Monthly Budget** - Configurable comparison basis (3/6/12-month or same month last year), chosen on the legend and remembered per device (#49).
- **Capy** - Live cache invalidation per mutation; `list_transactions` gains `sort` + `offset`; new `transaction_bounds` tool.
- **Capy** - Don't drop the in-memory repo cache between in-process mutations — was silently losing all-but-the-last write in multi-tool Anthropic/OpenAI turns.
- **Capy** - Fix ~30s post-message hang by decoupling loop exit from stream drain across all three adapters (#44).
- **Capy** - Silence Claude CLI "deliberation" assistant turn via `--disallowedTools` and a voice rule in the chat prompt (#44).
- **Capy** - Treat `render_followups` as a terminal-signal tool — model's call ends the turn without an ack round-trip (#44).
- **Capy** - Render API errors with the provider's human-readable message and a billing CTA for credit/quota failures (#44).
- **Transactions Browser** - Read-only pre-filtered transaction popup, drilldowns from Monthly Budget / Spending / Merchants tabs.
- **Specs** - Drop roadmap from spec set; trim intelligence-layer references.
- **Chat** - Fix AI output overwrite cascade; tighten render discipline; OpenAI follow-ups.

## 0.21.0 — 2026-05-16

Release prep: branding, promo redesign, auto-updater scaffolding.

- App icon, favicons, and social meta for capybudget.app
- Promo site magazine-layout redesign with serif headlines and app-mockup hero
- Auto-updater wired up; release workflow signs and publishes builds

## 0.20.0 — 2026-05-11

Welcome redesign, chat panel redesign, intelligence hardening.

- Welcome screen split into New / Open Existing with demo refresh
- Chat panel redesign with Capy mascot as load-bearing UI (Phase 10.5b)
- Intelligence layer hardening (Phase 10.5c): idempotent enrich, fixed receipt-stall regression
- Five new tools: `set_category_budget`, `unarchive_account`, `unarchive_category`, `set_net_worth_exclusions`, `bulk_update_transactions`
- DATA_MODEL + PRODUCT excerpts baked into chat prompt; `read_spec` exposes the rest

## 0.19.0 — 2026-05-03

Phase 10 kick-off: Net Worth filter, Monthly Budget tab, multi-provider intelligence.

- Net Worth account filter — choose which accounts contribute to net worth (Phase 10.1)
- Monthly Budget tab — per-category budgets with progress (Phase 10.2)
- Multi-provider intelligence — Anthropic API and OpenAI alongside Claude Code CLI (Phase 10.5)
- Chat and Smart Import work identically across all three providers
- Demo: Analytics dashboard renders on Budget tab; GitHub source link in demo header

## 0.18.0 — 2026-05-02

Analytics dashboard (Phase 8) — tab-based budget exploration.

- Six tabs: Spending, Cash Flow, Net Worth, Compare, Merchants, Monthly Budget (stub)
- Per-tab date controls with period pills
- Compare tab: category checklist with multi-line chart
- Category management dialog moved to gear icon

## 0.17.0 — 2026-03-23

Smart Import v2 — CSV transform engine, instant normalization.

- CSV transform engine: AI defines column mapping, code processes all rows instantly
- Disk-based file management: files saved to `.capy/import/sources/` on drop, survives crashes
- `auto_enrich`: code-based category, account, and merchant matching
- Primitive enrichment tools: AI uses `enrich_stats`/`enrich_sample`/`enrich_update` like a REPL
- Import sessions survive navigation (Zustand store with explicit phase machine)
- Import nav indicator pulses during active normalization or enrichment
- Stop enrichment button with progress auto-refresh

## 0.16.0 — 2026-03-23

Navigation rail — top-level section switching for Accounts, Budget, and Import.

- Navigation rail (desktop) and bottom tab bar (mobile) replace sidebar footer links
- Accounts sidebar is contextual — only visible on the Accounts section, hidden on Budget/Import
- Sidebar slides in/out via an edge handle; Budget and Import get full content width
- Header spans full width above the rail for correct visual hierarchy
- Transaction list scrolls horizontally on narrow viewports

## 0.15.1 — 2026-03-22

Promo website polish — light/dark theme support with semantic design tokens.

- Light/dark theme toggle with system preference detection and localStorage persistence
- Semantic color tokens (heading, body, muted, surface, line, etc.) auto-switch with theme
- Light theme: V3 warm cream palette with terra/sage/gold accents
- Dark theme: V2 dark glass aesthetic with amber accents and ambient orbs

## 0.15.0 — 2026-03-22

Promo website — Astro 6 static site for capybudget.app.

- Marketing landing page with feature grid and download/demo CTAs
- Privacy policy page
- Docs section powered by MDX content collections (getting-started guide)
- Deployed to Vercel, separate from the GitHub Pages demo

## 0.14.0 — 2026-03-21

Import duplicate detection — prevent accidental re-imports.

- Transaction-level duplicate detection: matches against existing budget by date, amount, description, and account
- File-level duplicate warning: flags previously imported filenames in the drop zone
- Detected duplicates auto-unselected with inline indicators and summary banner

## 0.13.0 — 2026-03-20

Smart Import — Merge step: finalize imports into the budget.

- Merge button with confirmation dialog showing transaction count, total, and new accounts
- Auto-creates accounts for unmapped import sources
- Persists account aliases for future imports
- Import log records source files, date range, and stats
- Undo support via snapshot capture before merge

## 0.12.0 — 2026-03-20

Smart Import — Enrich step: AI identifies merchants and categorizes imported transactions.

- Enrichment session auto-runs after normalization, filling merchant names and categories
- `search_merchants` MCP tool matches cryptic descriptions against existing budget data
- Per-row category selector with confidence indicators (green=high, amber=low)
- Account mapping moved to dedicated section; category mapping handled by AI
- Re-enrich button for manual re-runs after user corrections

## 0.11.0 — 2026-03-16

File attachments for Capy intelligence — upload bank imports, screenshots, and other files.

- Attach files to chat messages via paperclip button or drag-and-drop anywhere on the overlay
- Image files sent as multimodal content (base64) so Claude can see screenshots
- Text files (CSV, OFX, QFX, etc.) inlined in the message with filename markers
- Attachment chips with file size, type-aware icons, and remove button
- Size limits: 5MB per file, 10MB total

## 0.10.0 — 2026-03-15

Web demo — browser-based demo deployed to GitHub Pages.

- Demo shell at `apps/demo/` mounts the same `@capybudget/app` with no Tauri dependency
- Three budget presets (underwater, paycheck-to-paycheck, no-stress) with in-memory repository
- Stub intelligence layer showcasing rich content rendering, prompts desktop install for real AI
- Tauri module stubs so shared app code runs unmodified in the browser
- GitHub Actions workflow: deploys to GitHub Pages on push to main

## 0.9.0 — 2026-03-15

Intelligence layer polish — full CRUD, streaming fixes, session management.

- Full CRUD via Capy: 12 mutation MCP tools so Claude can do everything the UI can
- Streaming rework: append-only rendering, persistent tool activity in chat history
- Stop button with session recovery: interrupts response, forwards conversation context to next session
- Custom instructions and editable quick commands, stored in budget folder
- Claude can read budget CSV files directly for debugging

## 0.8.0 — 2026-03-14

Monorepo extraction — shared packages for code reuse across desktop, MCP, and future web demo.

- npm workspaces monorepo with 5 packages: core, persistence, intelligence, app, mcp
- `@capybudget/core`: types, money utilities, pure entity services extracted from app
- `@capybudget/persistence`: repository interface, FileAdapter abstraction, CSV implementation decoupled from Tauri
- `@capybudget/intelligence`: CapySession interface, stream event types, system prompt
- `@capybudget/app`: full React application (components, hooks, stores, routes)
- `@capybudget/mcp`: standalone MCP server rebuilt on shared packages — zero duplicated code, works with any MCP-compatible AI agent
- Desktop shell reduced to 4 files: main.tsx, TauriFileAdapter, budget service, type declarations
- Adapter pattern: FileAdapter, CapySession, BudgetService for platform decoupling

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
