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

The agent converts dropped files into a uniform internal CSV format, stored in `.capy/import/`. CSV is chosen over JSON — more fault-tolerant and more efficient on the context window.

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

### 3. Preview

An independent front-end module operating entirely on import files — no direct budget data dependency until merge.

**Mapping section** at the top: lists new accounts and categories discovered during normalization. Each can be mapped to an existing budget entity or marked for creation. Unmapped sources default to "Create" — no gating on mapping completeness.

**Transaction table** below: full CRUD, multi-select (unselect to ignore a transaction), search, inline editing. Same interaction patterns as the main transactions view — sorting, filtering, click-to-edit cells, bulk actions. User fixes errors, dates, amounts. Changes write back to the import file.

**Aliases** are stored in `.capy/aliases.json` and survive across imports. When a new import begins, mappings are pre-populated from aliases — so returning users don't re-map the same accounts and categories every time. Aliases are persisted at merge time.

### 4. Enrichment (Magic Button)

Logical successor of the Start button, shown in the preview area. Intelligence categorizes transactions and sets the merchant field. Each assignment includes a confidence level (`high` | `low`) that the frontend can interpret visually.

The agent also resolves `sourceAccount` and `sourceCategory` strings to existing budget entities.

### 5. Review & Merge

User reviews enriched data, makes final corrections.

Merge pumps processed data into the budget database — creating mapped entities and bulk-inserting transactions. Unmapped sources are created as new entities.

## Import State

Import is persistent — the user can leave the screen and return. A sidebar navigation item indicates when an import is in progress.

Cancel resets to the file drop screen at any time, clearing import data from `.capy/import/`. Aliases (`.capy/aliases.json`) are preserved across cancellations.

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

### Import file tools

File operations scoped to `.capy/import/` — the agent reads and writes normalized data here:

- `read_import_file` / `write_import_file` / `append_import_file` — CRUD for import staging files
- `list_import_files` — directory listing

### Budget query tools

Deterministic functions querying budget data, available during both normalization and enrichment:

- `list_accounts` — all accounts with balances
- `list_categories` — all categories grouped
- `list_transactions` — filterable by account, merchant substring, date range
- `spending_summary` — totals by category for a date range

Offload as much matching work as possible from the intelligence layer into precise, composable tools.

## Custom Instructions

The import screen exposes an editor for `capy-instructions.md` — the same file used by the Capy overlay. Users can tune agent behavior before running normalization or enrichment.

## Design Principles

- The preview area is a self-contained module. It reads/writes import files only.
- Intelligence is invoked at two discrete points: normalization and enrichment. The user is always in control between steps.
- The main budget data is read-only until merge.
- All intermediate state lives in `.capy/import/` — no pollution of the budget database during import.
