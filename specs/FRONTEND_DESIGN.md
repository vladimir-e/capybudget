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

### Confirmation Dialogs

Be explicit about consequences. Warn when deleting a transfer (both legs go), deleting a category (N transactions affected), or explain why an archive is blocked.

### Empty States

Guide the user: prompt to create first account, first transaction, or explain empty filter results. When adding a transaction with no accounts, intercept and trigger account creation.

## Typography

- Font: Geist Variable (sans-serif).
- Tabular figures (`font-variant-numeric: tabular-nums`) for all financial amounts. Numbers must align vertically in columns.

## Accessibility

- 44px minimum touch targets (WCAG 2.5.5).
- No hover-only interactions — everything works on keyboard.
- Active navigation: `aria-current="page"`.
- Icon-only buttons: `aria-label`.
- Semantic color tokens for amounts, not raw color values.
