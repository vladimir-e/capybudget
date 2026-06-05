# Frontend Design

Visual design, interaction patterns, and accessibility guidelines.

## Color Scheme

The app uses **OKLCh color space** for perceptually uniform colors. Every theme defines a full set of CSS custom properties (brand, neutrals, semantic, sidebar, charts) in both light and dark variants.

### Architecture

- **Light/dark mode** — managed by `next-themes`, toggled via a three-state cycle (light → dark → system). Applies `.dark` class to `<html>`.
- **Color themes** — managed by `ColorThemeProvider`, persisted to `localStorage` under `color-theme`. Applies `data-theme` attribute to `<html>`.
- Both are independent — any color theme works in light or dark mode.

### Themes

| Theme    | Character                          | Hue  |
|----------|------------------------------------|------|
| Capybara | Warm amber/sand — the default      | ~55  |
| Ocean    | Cool blue                          | ~240 |
| Forest   | Green/emerald                      | ~152 |
| Rose     | Pink/mauve                         | ~350 |
| Slate    | Minimal chroma, neutral cool gray  | ~260 |

### Design Principles

- **Hue-tinted neutrals.** Every gray in a theme carries a subtle tint of the theme's hue, not pure gray. This gives warmth (Capybara) or coolness (Ocean) to the entire UI.
- **Semantic colors are stable.** Expense (terracotta), income (sage), and destructive (red) stay the same across all themes — they carry meaning, not branding.
- **Perceptual uniformity.** OKLCh ensures that colors with the same lightness value actually look equally bright, so light/dark variants are consistent across themes.

### Adding a New Theme

1. Add an entry to `packages/app/src/lib/color-themes.ts` with a label and swatch color.
2. Add `[data-theme="<name>"]` and `[data-theme="<name>"].dark` blocks in `packages/app/src/styles/index.css`, following the existing pattern (shift hue, keep luminance/chroma structure).

## Navigation

Three top-level sections: **Accounts**, **Budget** (categories), and **Import**.

- **Desktop**: vertical navigation rail (left edge, 64px) with icon+label links. The header spans full width above the rail.
- **Mobile**: bottom tab bar with the same three sections.
- **Sidebar**: scoped to the Accounts section only. Slides in/out via its own edge handle. Budget and Import sections get full content width.
- **Settings**: lives in a bottom utility cluster on the desktop rail (gear icon), kept separate from the primary three to signal "infrequent / configuration." Intentionally not surfaced in the mobile bottom-tab bar — mobile is a read-mostly surface and the rail's vertical room doesn't translate there.

Capy is shipped a static app map (`specs/APP_MAP.md`) so it can answer "where do I find X" without guessing. It mirrors this structure — sections, the analytics tabs, the nav layout, and each tab's chart and controls. Re-check it whenever the UI changes structurally so it doesn't silently drift from the real app.

## Chat Panel

Capy's chat panel slides out from the right edge — full-width on mobile, default 440px on desktop with a draggable left edge (max `min(50vw, 720px)`, width persisted). Non-modal: the rest of the app stays interactive while the panel is open.

The header (mascot avatar, name, status, "New chat", close) is persistent across every state. The close icon is "Hide panel" — collapsing the panel preserves the session; "New chat" is the explicit reset.

Empty states:
- **Unconfigured** (`provider === null`): mascot + setup copy + provider quick-pick chips + "Open settings". Input is hidden until a provider is configured.
- **Welcome** (configured, no messages): mascot + greeting + four suggestion cards (click sends prompt as user message).

Conversation:
- Tool calls render as a stacked card with spinner→checkmark; the card persists in history.
- Money and percentages get inline emphasis via lightweight `**bold**` parsing rendered in brand color (bold/italic XOR — not nestable).
- Follow-up suggestion chips appear after responses (model-driven via `render_followups`) and click-to-send.

## UX Principles

Keyboard-first workflow for the majority of user actions. Controls are intuitive — ESC closes modals, Enter confirms, Tab navigation in forms makes sense.

### Transaction Entry

- **Hero amount input**: large text, type-aware coloring (red/green/neutral).
- **Segmented type control** (expense/income/transfer) with semantic colors.
- **Keyboard shortcuts in amount field**: `-` → expense, `+` → income.
- **Merchant autocomplete**: typeahead from past merchants (word-start priority), selecting a known merchant auto-fills the category.
- **Convenient date input.**
- **Pre-select the currently viewed account.**

### Transaction List

- Columns: date, account, merchant, category, amount.
- Sortable by any column. Inline editing — click to edit.
- Full-text search across all visible fields, including money e.g. "12.50" finds transactions with amount=1250. Category filter, date range picker.
- "All Accounts" view for cross-account overview.
- Transfers don't have category/merchant columns and display from/to accounts instead.

### Transactions Browser (Drilldown)

Analytics surfaces — Monthly Budget, Spending, Merchants — each render aggregate numbers. Every meaningful aggregate is a drilldown into the underlying transactions: clicking opens a **read-only, pre-filtered transactions popup** (modal, portalled, ESC + click-outside close) showing exactly the rows that produced that number.

- **Read-only.** No inline editing, deletion, selection, or bulk actions in the popup. Editing remains the job of the account-detail view.
- **Pre-filtered, locked context.** The caller filters the transactions array and passes locked-filter chips for display (category, merchant, date range). Chips are not removable — to broaden, the user closes the modal.
- **Conditional search.** A local substring search field (across merchant, category, note, and amount in both formatted and raw forms) appears only when the list has **more than 10 rows**. Below that threshold a search box is clutter and the eye can scan faster.
- **Virtualization** carries over from the shared `TransactionList` — the popup handles a category with hundreds of transactions without jank.

Drilldown points wired this pass:

| Surface | Click target | Locked filter |
|---|---|---|
| Monthly Budget | "Spent" cell on a category row (when > $0) | category + month |
| Spending | Pie slice (current view mode: expenses or income) | category + period |
| Merchants | Merchant name in the ranked list, or its bar in the chart | merchant + period |

The same component is shaped to render later as a Capy-chat block (no modal chrome) and behind a `/transactions` deeplink route. Modal-only this pass.

### Monthly Budget

Every expense-side category (Income excluded) shows a live progress bar tracking this month's spend against a target — without anyone assigning a number first. The target is `assigned ?? implicitTarget`: an explicit budget when the user sets one, otherwise a target derived from the category's own spending history. See `PRODUCT.md` for the model and `DATA_MODEL.md` for where the number comes from.

**KPI strip** (three cards): **Spent this month** (all categorized expense, drills into the transactions), **Tracking toward** (sum of effective targets across all rows), **Over budget** (count of rows whose spend exceeds their target).

**The zoned bar.** Each row's bar is a small infographic, not a percent meter:

- **Two zones.** A green "within" zone (0 → target) and a red "over" zone (target → off the end), split by a target divider sitting at a fixed fraction of the track width — the same fraction on every row. Because the divider is positionally fixed, the over/under line scans straight down the column: a row is over budget exactly when its fill crosses the divider, regardless of dollar size.
- **The fill** grows with spend and is **binary green up to and including the target, red only past it**. Reaching 100% of a target is on-budget, not a warning — rent at exactly its target reads green. Overshoot beyond the target is log-compressed into the over-zone so an extreme overspend can't blow out the layout.
- **History pins.** Up to two diamond markers float above the track on the bar's scale: a **filled** diamond for last month's spend, a **hollow** one for the comparison basis (the reference average). Hover or keyboard focus reveals the exact figure.
- **The divider** is **dashed and ghosted when the target is auto-derived**, **solid and strong when the user set it** — so you can tell at a glance which targets you own and which Capy inferred.
- **Untargeted rows** (no budget, no usable history) render a calm faint dashed track with no zones, fill, pins, or divider — never red. They sit at reduced opacity and carry a muted dot rather than the brand dot. The bar only signals state; the spend itself lives in the Spent column.
- **Explicit zero target** ("don't spend here") collapses the green zone to nothing: the divider sits at the left edge and any spend reads as a full red bar.

**Remaining column.** A tracked row shows target-minus-spend; an overspend reads as a signed negative ("-$88.30") in the expense token, so the minus sign carries the "over" meaning without relying on color. An untargeted row shows an em-dash.

**Legend & comparison basis.** A compact, right-aligned key for the two history pins, pairing each glyph with text so the markers never rest on color alone. It sits near where the pins render and appears once at least one row draws a real bar. The filled last-month item is static. The hollow-diamond item doubles as the **comparison-basis picker**: a dropdown whose label is the resolved basis — `3-mo avg`, `6-mo avg`, `12-mo avg`, or the named month for "same month last year" (e.g. `Dec 2024`) — with a chevron. Its menu offers the four bases (*3 months · 6 months · 12 months · same month last year*); the trailing options average the active months in that window, "same month last year" reads the single month a year before. The choice is a local display preference, remembered per device like the color theme — it lives in the browser, not the budget file, so it isn't synced across machines. Picking a basis recomputes every row's reference pin, its auto-target, and the "Tracking toward" KPI in place; the filled last-month pin and the `max(last month, reference)` target rule are unaffected. The zones, fill, and divider are visually self-evident and carry no legend row.

**First month & filtering.** On a first month with no spending history, every implicit target is null; an inline note frames the empty bars as "forming" rather than broken and points at this month's spend. A "Show only tracked" toggle collapses the view to the rows Capy is actively tracking (explicit or implicit target), a counter reads `N of M tracked`, and each group header shows an `N/M tracked` count. The toggle and counter appear only once some rows are tracked and others aren't.

**Editing a target.** The Target cell is click-to-edit, with the amount pegged to the column's right edge so every row's figure aligns. An explicit budget shows its amount; an implicit one shows an "auto" tag to the left of the auto-derived number (so the user sees Capy's inferred figure and can override it); an untargeted row shows a quiet "set" affordance. Clearing the input reverts to auto/untargeted; `0` commits as an explicit zero target.

### Confirmation Dialogs

Be explicit about consequences. Warn when deleting a transfer (both legs go), deleting a category (N transactions affected), or explain why an archive is blocked.

### Empty States

Blank states guide the user toward the next step: prompt to create a first account, a first transaction, or explain empty filter results. When adding a transaction with no accounts, intercept and trigger account creation.

## Typography

- Font: Geist Variable (sans-serif).
- Tabular figures (`font-variant-numeric: tabular-nums`) for all financial amounts. Numbers must align vertically in columns.

## Accessibility

- 44px minimum touch targets (WCAG 2.5.5).
- No hover-only interactions — everything works on keyboard.
- Active navigation: `aria-current="page"`.
- Icon-only buttons: `aria-label`.
- Semantic color tokens for amounts, not raw color values.
