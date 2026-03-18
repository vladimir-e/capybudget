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

**Mapping section** at the top: lists new accounts and categories discovered during normalization. Each can be mapped to an existing budget entity or marked for creation.

**Transaction table** below: full CRUD, multi-select (unselect to ignore a transaction), search, inline editing. Same interaction patterns as the main transactions view — sorting, filtering, click-to-edit cells, bulk actions. User fixes errors, dates, amounts. Changes write back to the import file.

### 4. Enrichment (Magic Button)

Logical successor of the Start button, shown in the preview area. Intelligence categorizes transactions and sets the merchant field. Each assignment includes a confidence level (`high` | `low`) that the frontend can interpret visually.

The agent also resolves `sourceAccount` and `sourceCategory` strings to existing budget entities.

### 5. Review & Merge

User reviews enriched data, makes final corrections. **Merge** button enabled only when all account/category mappings are resolved.

Merge pumps processed data into the budget database — creating mapped entities and bulk-inserting transactions.

## Import State

Import is persistent — the user can leave the screen and return. A sidebar navigation item indicates when an import is in progress.

Cancel resets to the file drop screen at any time, clearing `.capy/import/`.

## Import Log

On successful merge, an import log file is created (or appended to) in the budget folder. Each entry records:

- Source file names
- Date of import
- Quick stats (transaction count, accounts, date range)

The log is surfaced on the import screen — a panel the user can open to review past imports. Capy (the AI assistant) should also be aware of this log for audit queries.

Merge clears the `.capy/import/` folder after writing the log entry.

## Intelligence Tools

Provide MCP tools that make the agent's job easier and reduce context usage:

- **Merchant search** — fuzzy search across existing merchants
- **Transaction history search** — query historical records by merchant, amount, date range
- **Category lookup** — find categories by name or spending patterns

These are deterministic functions querying budget data. Offload as much matching work as possible from the intelligence layer into precise, composable tools.

## Custom Instructions

The import screen exposes an editor for `capy-instructions.md` — the same file used by the Capy overlay. Users can tune agent behavior before running normalization or enrichment.

## Design Principles

- The preview area is a self-contained module. It reads/writes import files only.
- Intelligence is invoked at two discrete points: normalization and enrichment. The user is always in control between steps.
- The main budget data is read-only until merge.
- All intermediate state lives in `.capy/import/` — no pollution of the budget database during import.
