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

Start triggers intelligence. The agent reads its own `import-instructions.md` from the budget folder — kept separate from the chat's `capy-instructions.md` so import-tuning notes don't bleed into chat behavior and vice versa.

The agent converts dropped files into a uniform internal CSV format, stored in `.capy/import/transactions.csv`. Two normalization paths:

- **CSV files**: AI analyzes a sample via `analyze_csv`, defines a `CsvMapping` (column positions, date format, amount format, skip rows), previews via `preview_transform`, then executes `transform_csv`. All rows processed instantly in code — no AI per-row processing. When multiple CSVs are imported, each `transform_csv` call appends to the existing `transactions.csv` with continuing IDs.
- **Images/PDFs**: bytes ride into the **initial user message as multimodal content** — image blocks for PNG/JPG/etc., document blocks for PDFs. The agent reads them directly from the message (no Read-tool round-trip) and writes extracted rows via `write_import_file` (`mode: "append"` to add to rows already written from another source). Suitable for small-volume imports (receipts, statements).

OpenAI's chat.completions API doesn't accept PDF input. When the OpenAI provider is selected and the user has dropped a `.pdf`, the import screen banners "switch provider or remove the PDF" and disables Start until the gate clears.

#### Import CSV Schema

| Column | Type | Description |
|---|---|---|
| `id` | string | Sequential: `imp-1`, `imp-2`, `imp-3`, … |
| `date` | string | `YYYY-MM-DD` |
| `description` | string | Raw description from source — preserved exactly as-is |
| `amount` | integer | Cents. Negative = expense, positive = income |
| `type` | string | `expense`, `income`, or `transfer` |
| `sourceAccount` | string | Raw account string from source file — not yet matched |
| `sourceCategory` | string | Raw category string from source file — not yet matched |
| `memo` | string | Additional notes or reference numbers |
| `merchant` | string | Clean human-readable merchant name. Set during normalize for unambiguous receipt/PDF cases, otherwise filled during enrichment |
| `accountId` | string | Budget account UUID — set during enrichment |
| `targetAccountId` | string | Target account UUID for transfers — set during enrichment |
| `categoryId` | string | Budget category UUID. Set during normalize when confident, otherwise filled during enrichment |
| `categoryConfidence` | string | `high` for unambiguous matches, `low` for inferred. Set alongside `categoryId` |

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

1. `auto_enrich` runs first — code-based matching (sourceCategory to categories, sourceAccount to accounts, transfer-target resolution). It intentionally does **not** populate `merchant` — the raw description is the wrong value for the cleaned merchant slot, and at merge time `description` already maps to `Transaction.note` while `merchant` is reserved for the cleaned name the model fills in. It's **code-triggered**: the orchestrator runs it as a deterministic pre-pass, and it's not advertised to the model (no `TOOL_MODES` entry), though it stays dispatchable via `runTool` and on the MCP surface.
2. `enrich_status` gives the AI a compact progress summary. Pass `sampleSize > 0` (with optional `sampleField`) to also return that many evenly-spaced rows needing work — a representative cross-section, not just the first rows.
3. `enrich_update` applies bulk SET WHERE updates (like SQL UPDATE). Supports single or array of WHERE conditions (AND logic). Returns **per-field counts** (set / skipped-as-already-populated) so the model can tell exactly what landed. Validates `categoryId` against the budget's real category UUIDs.

The session works idempotently: step 0 is always `enrich_status`; if coverage is already complete (which is common after a small CSV or a receipt extracted directly during normalize), the session reports the work is done and stops. Otherwise the AI works in a REPL loop — check status (with a sample), apply a pattern in parallel (merchant + categoryId in the same `enrich_update`), repeat until two consecutive update calls produce zero changes or coverage is complete. Per-session tool-call budget (100, defined in the intelligence layer) is a runaway backstop.

### 5. Review & Merge

User reviews enriched data, makes final corrections.

Merge pumps processed data into the budget database — creating mapped entities and bulk-inserting transactions. Unmapped sources are created as new entities.

**Field mapping at merge time:**

| Import CSV column | `Transaction` field |
|---|---|
| `description` (raw bank/receipt text) | `note` — concatenated with `memo` via `" — "` if both present |
| `memo` | `note` (combined with `description`) |
| `merchant` (cleaned by enrichment) | `merchant` |
| `categoryId` | `categoryId` |
| `accountId` (resolved at merge) | `accountId` |

The `merchant` field on `Transaction` is reserved for the cleaned, human-readable name. The raw description belongs in `note`. Enrichment never copies one into the other.

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

- `auto_enrich` — score-based matching (sourceCategory→categories, sourceAccount→accounts, transfer-target resolution). Leaves `merchant` empty for the model to fill with cleaned names. Code-triggered (deterministic pre-pass), not advertised to the model.
- `enrich_status` — compact progress summary (how many rows enriched, how many remain). With `sampleSize > 0`, also appends that many evenly-spaced CSV rows needing work (representative sampling); `sampleField` filters which empty field.
- `enrich_update` — bulk SET WHERE (like SQL UPDATE) for merchant, category, account, confidence. Supports array of WHERE conditions (AND logic). Only sets empty fields. Returns per-field counts (set vs skipped). Validates `categoryId` against real budget category UUIDs.

### Budget query tools

Deterministic functions querying budget data, available during both normalization and enrichment:

- `list_accounts` — all accounts with balances
- `list_categories` — all categories grouped
- `list_transactions` — filterable by account, merchant substring, date range

## Custom Instructions

The import screen exposes an editor for `import-instructions.md` in the budget folder — separate from the chat overlay's `capy-instructions.md` so import-specific notes don't bleed into chat behavior. Users can tune agent behavior here before running normalization or enrichment.

## Design Principles

- The preview area is a self-contained module. It reads/writes import files only.
- Intelligence is invoked at two discrete points: normalization and enrichment. The user is always in control between steps.
- The main budget data is read-only until merge.
- All intermediate state lives in `.capy/import/` — no pollution of the budget database during import.
