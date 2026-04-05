# Smart Import

Drop a file, intelligence normalizes it, you review and merge. The app is fully functional without import — it's additive.

## Flow

```
Import Page → Drop Files → Start → Normalization… → Preview → Enrich… → Review → Merge → Cleanup
```

### 1. File Drop

Import screen with a drop zone and "Add files" control. Requires intelligence (Claude CLI) — shows an offline state when unavailable. Design should be pleasant and polished.

When files are added, a **Start** button becomes active.

Supported input: CSV, images, PDFs.

### 2. Normalization (Intelligence)

Start triggers intelligence. The agent reads the same custom instructions as the Capy chat (`capy-instructions.md`).

The agent converts dropped files into a uniform internal CSV format, stored in `.capy/import/transactions.csv`. Two normalization paths:

- **CSV files**: AI analyzes a sample via `analyze_csv`, defines a `CsvMapping` (column positions, date format, amount format, skip rows), previews via `preview_transform`, then executes `transform_csv`. All rows processed instantly in code — no AI per-row processing. When multiple CSVs are imported, each `transform_csv` call appends to the existing `transactions.csv` with continuing IDs.
- **Images/PDFs**: AI reads files from disk, extracts transactions manually. Suitable for small-volume imports (receipts, statements).

#### Import CSV Schema

| Column | Type | Description |
|---|---|---|
| `id` | string | Unique row identifier |
| `date` | string | Transaction date |
| `description` | string | Raw description from source |
| `amount` | integer | Amount in cents |
| `type` | string | `expense`, `income`, or `transfer` |
| `sourceAccount` | string | Raw account string from source file — not yet matched |
| `sourceCategory` | string | Raw category string from source file — not yet matched |
| `memo` | string | Additional notes |

`sourceAccount` and `sourceCategory` are raw strings extracted from the file. They are resolved to budget entities later during enrichment.

Transfer detection is a hard problem — the agent must identify matching pairs across accounts and dates.

### File Management

Files are saved to `.capy/import/sources/` immediately on drop — disk is the source of truth. Import state survives crashes.

```
.capy/import/
  sources/          # User's original files (CSV, images, PDFs)
  transactions.csv  # Normalized output
  state.json        # Import metadata
```

### 3. Preview

An independent front-end module operating entirely on import files — no direct budget data dependency until merge.

**Mapping section** at the top: lists new accounts and categories discovered during normalization. Each can be mapped to an existing budget entity or marked for creation. Unmapped sources default to "Create" — no gating on mapping completeness.

**Transaction table** below: full CRUD, multi-select (unselect to ignore a transaction), search, inline editing. Same interaction patterns as the main transactions view — sorting, filtering, click-to-edit cells, bulk actions. User fixes errors, dates, amounts. Changes write back to the import file.

**Aliases** are stored in `.capy/aliases.json` and survive across imports. When a new import begins, mappings are pre-populated from aliases — so returning users don't re-map the same accounts and categories every time. Aliases are persisted at merge time.

### 4. Enrichment (Magic Button)

Logical successor of the Start button, shown in the preview area. Intelligence categorizes transactions and sets the merchant field. Each assignment includes a confidence level (`high` | `low`) that the frontend can interpret visually.

The agent also resolves `sourceAccount` and `sourceCategory` strings to existing budget entities.

Enrichment uses primitive tools instead of bulk CSV read/write:

1. `auto_enrich` runs first — code-based matching (sourceCategory to categories, sourceAccount to accounts, description to merchant). Uses score-based fuzzy matching for categories.
2. `enrich_stats` gives the AI a compact progress summary.
3. `enrich_sample` returns ~20 evenly-spaced rows needing work — representative cross-section, not just the first rows.
4. `enrich_update` applies bulk SET WHERE updates (like SQL UPDATE). Supports single or array of WHERE conditions (AND logic).

The AI works in a size-aware REPL loop: for small imports (~30 rows), it processes individually; for large imports, it pattern-matches in bulk — check stats, read a sample, apply a pattern, repeat. It also cleans merchant names (stripping bank prefixes, location suffixes, store numbers). Enrichment results are cached in memory across tool calls for efficiency.

### 5. Review & Merge

User reviews enriched data, makes final corrections.

Merge pumps processed data into the budget database — creating mapped entities and bulk-inserting transactions. Unmapped sources are created as new entities.

## Import State

Import state lives in a Zustand store with an explicit phase machine: `idle` → `normalizing` → `preview`. Sessions survive navigation — the user can leave the import screen and return without losing progress. The navigation indicator pulses during active normalization or enrichment.

Cancel resets to the file drop screen at any time, clearing import data from `.capy/import/`. Aliases (`.capy/aliases.json`) are preserved across cancellations. A stop button allows interrupting enrichment mid-session, with progress auto-refresh.

## Import Log

On successful merge, an import log file is created (or appended to) in the budget folder. Each entry records:

- Source file names
- Date of import
- Quick stats (transaction count, accounts, date range)

The log is surfaced on the import screen — a panel the user can open to review past imports. Capy (the AI assistant) should also be aware of this log for audit queries.

Merge clears the `.capy/import/` folder after writing the log entry.

## Duplicate Detection

Two layers prevent accidental re-import of the same data.

### File-level

When files are added to the drop zone, their names are checked against the import log (last 20 entries). Files that were previously imported get an amber warning with the date of the prior import. This is advisory — the user can still proceed.

### Transaction-level

During preview, imported transactions are matched against existing budget transactions. Detected duplicates are auto-unselected (but can be re-selected manually). A banner shows the count.

Matching rules, checked in order (first match wins per transaction, greedy 1:1):

1. **High confidence** — same date + amount + description (substring, case-insensitive) + same resolved account
2. **High confidence** — same date + amount + description, no account info on the import side
3. **Low confidence** — same date + amount + same account (description empty or different)
4. **Low confidence** — date ±1 day + amount + same account

Account resolution uses the account mapping (sourceAccount → budget accountId).

## Intelligence Tools

### CSV transform tools

Code-based normalization — AI defines the mapping, code processes all rows:

- `analyze_csv` — returns headers, sample rows (efficiently parsed), row count estimate, and parse errors if any
- `preview_transform` — applies a CsvMapping to sample rows, returns preview of normalized output with parse errors
- `transform_csv` — executes the mapping against all rows, appends to `transactions.csv` (supports multi-file imports)

### Enrichment tools

Primitive tools for AI-assisted enrichment — small samples in, bulk updates out:

- `auto_enrich` — score-based matching (sourceCategory→categories, sourceAccount→accounts, description→merchant)
- `enrich_stats` — compact progress summary (how many rows enriched, how many remain)
- `enrich_sample` — ~20 evenly-spaced CSV rows needing work (representative sampling)
- `enrich_update` — bulk SET WHERE (like SQL UPDATE) for merchant, category, account, confidence. Supports array of WHERE conditions (AND logic). Only sets empty fields.

### Budget query tools

Deterministic functions querying budget data, available during both normalization and enrichment:

- `list_accounts` — all accounts with balances
- `list_categories` — all categories grouped
- `list_transactions` — filterable by account, merchant substring, date range
- `spending_summary` — totals by category for a date range

## Custom Instructions

The import screen exposes an editor for `capy-instructions.md` — the same file used by the Capy overlay. Users can tune agent behavior before running normalization or enrichment.

## Design Principles

- The preview area is a self-contained module. It reads/writes import files only.
- Intelligence is invoked at two discrete points: normalization and enrichment. The user is always in control between steps.
- The main budget data is read-only until merge.
- All intermediate state lives in `.capy/import/` — no pollution of the budget database during import.
