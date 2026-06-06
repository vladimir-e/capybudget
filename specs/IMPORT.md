# Smart Import

Drop a file, intelligence normalizes it, you review and merge. The app is fully functional without import — it's additive.

## Flow

```
Import Page → Drop Files → Start
  → [ Normalize → Accounts → Dedup → Enrich ] one run
  → Review → Merge → Cleanup
```

Start kicks off **one orchestrated run** that walks an ordered phase pipeline — **normalize → accounts → dedup → enrich** — in a single AI session. Each phase has a deterministic pre-step the orchestrator runs in code, then an agent turn injected as a fresh user message into the same session (sequential injection). The phases stream their activity on the import screen; the run lands on a merge-ready review (the preview table) — or, if every row is a duplicate, on a "nothing to import" result. See INTELLIGENCE.md § Import Sessions for the session mechanics (the phase machine, sequential injection, per-phase deterministic pre-steps, the dedup halt).

### 1. File Drop

Import screen with a drop zone and "Add files" control. Requires a configured intelligence provider (Anthropic API, OpenAI API, or Claude Code) — shows an offline state when none is set. Design should be pleasant and polished.

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
| `accountId` | string | Budget account UUID — resolved in the accounts phase |
| `targetAccountId` | string | Target account UUID for transfers — resolved during enrichment |
| `categoryId` | string | Budget category UUID. Set during normalize when confident, otherwise filled during enrichment |
| `categoryConfidence` | string | `high` for unambiguous matches, `low` for inferred. Set alongside `categoryId` |
| `duplicate` | boolean | `true` once the dedup phase marks the row as already in the budget |
| `duplicateOf` | string | The matched existing transaction's id (empty unless `duplicate`) |
| `duplicateConfidence` | string | `high` (auto-marked exact match) or `low` (agent-adjudicated) |

`sourceAccount` and `sourceCategory` are raw strings extracted from the file. `sourceAccount` is resolved to a budget `accountId` in the accounts phase; `sourceCategory` is resolved to a `categoryId` during enrichment.

The three `duplicate*` columns live on the staging CSV only — they drive the preview's dimming and the merge exclusion, and never enter the committed budget schema.

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

### 4. Account Mapping

The accounts phase resolves each raw `sourceAccount` string to a budget `accountId` and persists it onto the staging rows. This is **agent judgment, not string matching** — source names are messy (emojis, abbreviations, case, variants), and intelligence handles them where the old fuzzy name-matcher failed. Imports are small (usually one source account), so this is a handful of decisions.

Precedence is **stored aliases > agent judgment > manual map in preview**:

- The deterministic pre-step `apply_account_aliases` reads `.capy/aliases.json` and sets `accountId` on rows whose `sourceAccount` has a known alias — the authoritative top layer (prior user maps that pre-select reliably). Code-triggered; not advertised to the model.
- The agent turn maps the remaining unmapped source accounts via `enrich_update` (`set: { accountId }`). Because `enrich_update` only fills *empty* fields, aliased rows are never overridden — aliases win by construction. A source account with no plausible Capy match is set to the `__create__` sentinel; merge creates the account from the source name.
- The manual map in the preview is the user's final override, and the **only** path that writes new aliases — the agent's mapping persists `accountId` to staging but never touches the alias file, so a guess can't become a sticky alias.

Account mapping precedes dedup because dedup's matching rules key off the resolved account.

### 5. Duplicate Detection (run phase)

The dedup phase finds staging rows that already exist in the budget and persists the verdict (`duplicate`, `duplicateOf`, `duplicateConfidence`) onto staging, turning the preview from work-in-progress into final review. The principle is **matcher FINDS, model ADJUDICATES**: `detectDuplicates` (in core) is the deterministic finder — high confidence (exact date + amount + description + resolved account) and low confidence (date ±1, amount-only, fuzzy description). Because the accounts phase already resolved `accountId`, the finder's account-keyed rules now match correctly.

- The deterministic pre-step `auto_mark_duplicates` runs the finder and auto-marks every **high-confidence** match — exact matches need no judgment. Code-triggered; not advertised.
- The agent turn reviews the **low-confidence** candidates: `find_duplicates` returns the candidate set grouped by confidence (each with the matched original's merchant/category — never the full dataset), and `mark_duplicates` persists the ids the model judges to be genuine duplicates.
- **Marking dup-enriches.** Both marking tools copy the matched original's `merchant`/`categoryId` onto the row (filling only empties), so a dimmed preview row shows *what* it duplicates and a false-positive merge is already cleanly categorized.
- **All-duplicate halt.** After the agent's dedup turn ends, the orchestrator reads the staging CSV; if every row is now a duplicate, it skips enrich and completes the run with a `nothing-to-import` result ("All N transactions are already in your budget — nothing to import."). The code decides the halt from the persisted flags — not the model.

The frontend renders the persisted flags (the earlier live-recompute is retired): duplicate rows are dimmed and unselected, and merge excludes duplicate-and-unselected rows.

### 6. Enrichment

The enrich phase of the run — it follows dedup automatically in the same session via sequential injection (the model already knows what normalize, accounts, and dedup did, so there's no cold-start re-discovery). Intelligence categorizes transactions and sets the merchant field. Each assignment includes a confidence level (`high` | `low`) that the frontend can interpret visually. From the review table the user can re-run enrich manually (an **Enrich** button) after edits — a standalone session over the same CSV.

By here every row's `accountId` is already resolved (accounts phase), so enrich resolves `sourceCategory` to categories and transfer targets — not accounts. Duplicate-marked rows are skipped (already dup-enriched and excluded from the merge).

Enrichment uses primitive tools instead of bulk CSV read/write:

1. `auto_enrich` runs first — code-based matching (sourceCategory to categories, transfer-target resolution). It intentionally does **not** populate `merchant` — the raw description is the wrong value for the cleaned merchant slot, and at merge time `description` already maps to `Transaction.note` while `merchant` is reserved for the cleaned name the model fills in. It's **code-triggered**: the orchestrator runs it as a deterministic pre-pass, and it's not advertised to the model (no `TOOL_MODES` entry), though it stays dispatchable via `runTool` and on the MCP surface.
2. `enrich_status` gives the AI a compact progress summary. Pass `sampleSize > 0` (with optional `sampleField`) to also return that many evenly-spaced rows needing work — a representative cross-section, not just the first rows. Duplicate-marked rows are excluded from every count and the sample.
3. `enrich_update` applies bulk SET WHERE updates (like SQL UPDATE). Supports single or array of WHERE conditions (AND logic). Returns **per-field counts** (set / skipped-as-already-populated) so the model can tell exactly what landed. Validates `categoryId` against the budget's real category UUIDs.

Before guessing a category for a cryptic description, the enrich prompt steers the model to `search_transactions` the user's committed history for the same merchant and adopt the `merchant`/`categoryId` they already settled on (at `high` confidence — the user's own choice beats a fresh keyword guess).

The session works idempotently: step 0 is always `enrich_status`; if coverage is already complete (which is common after a small CSV or a receipt extracted directly during normalize), the session reports the work is done and stops. Otherwise the AI works in a REPL loop — check status (with a sample), apply a pattern in parallel (merchant + categoryId in the same `enrich_update`), repeat until two consecutive update calls produce zero changes or coverage is complete. Per-session tool-call budget (100, defined in the intelligence layer) is a runaway backstop.

### 7. Review & Merge

User reviews enriched data, makes final corrections.

Merge pumps processed data into the budget database — creating mapped entities and bulk-inserting transactions. Unmapped sources are created as new entities.

**Field mapping at merge time:**

| Import CSV column | `Transaction` field |
|---|---|
| `description` (raw bank/receipt text) | `note` — concatenated with `memo` via `" — "` if both present |
| `memo` | `note` (combined with `description`) |
| `merchant` (cleaned by enrichment) | `merchant` |
| `categoryId` | `categoryId` |
| `accountId` (resolved in the accounts phase) | `accountId` |

The `merchant` field on `Transaction` is reserved for the cleaned, human-readable name. The raw description belongs in `note`. Enrichment never copies one into the other.

## Import State

Import state lives in a Zustand store with an explicit phase machine: `idle → normalizing → accounts → dedup → enriching → review`. The orchestrated run advances through the working phases; `review` is the merge-ready terminal state. The run's single session survives navigation — the user can leave the import screen and return without losing progress. The navigation indicator pulses through every working phase, until the run reaches `review`.

Cancel resets to the file drop screen at any time, stopping the session and clearing import data from `.capy/import/`. Aliases (`.capy/aliases.json`) are preserved across cancellations. A stop button allows interrupting a manual re-enrich mid-session, with progress auto-refresh.

**Resume.** If a run dies after normalize wrote the staging CSV but before it finished (the app was closed, the process crashed), reopening the import screen reconnects: a fresh session re-runs the **full post-normalize pipeline** (accounts → dedup → enrich) over the existing staging rows via `IMPORT_RESUME_SYSTEM_PROMPT`. It never re-runs normalize — the dropped source files are gone, and the staging CSV is the input. If instead the run had already finished (the `enriched` flag is set in `state.json`), the reconnect lands straight on `review` and re-derives the terminal result from the staging tally, so the completion banner or "nothing to import" result survives the reload.

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

The agent-owned **dedup run phase** (§5) matches imported transactions against existing budget transactions and persists the verdict to staging — high-confidence exact matches auto-marked in code, low-confidence candidates adjudicated by the model. The preview renders the persisted flags: duplicates are dimmed and auto-unselected (re-selectable manually), with a banner showing the count. Merge excludes duplicate-and-unselected rows. The frontend does not recompute duplicates — it renders what dedup wrote.

The finder's matching rules, checked in order (first match wins per transaction, greedy 1:1):

1. **High confidence** — same date + amount + description (substring, case-insensitive) + same resolved account
2. **High confidence** — same date + amount + description, no account info on the import side
3. **Low confidence** — same date + amount + same account (description empty or different)
4. **Low confidence** — date ±1 day + amount + same account

Account resolution uses the `accountId` the accounts phase persisted onto each row — the brittle name-match the old frontend matcher relied on is retired, so rules 1/3/4 now key off a correctly resolved account.

## Intelligence Tools

The import session advertises one phase-spanning surface (the same tools across normalize → accounts → dedup → enrich). For the authoritative mode-membership list see INTELLIGENCE.md § Mode gating; the import surface is summarized here.

### CSV transform tools

Code-based normalization — AI defines the mapping, code processes all rows:

- `analyze_csv` — returns headers, sample rows (efficiently parsed), row count estimate, and parse errors if any
- `preview_transform` — applies a CsvMapping to sample rows, returns preview of normalized output with parse errors
- `transform_csv` — executes the mapping against all rows, appends to `transactions.csv` (supports multi-file imports)
- `write_import_file` — writes extracted rows directly (the image/PDF path); `mode: "append"` adds to existing rows

### Dedup tools

- `find_duplicates` — runs the finder and returns the candidate set grouped by confidence, each with the matched original's date/amount/merchant/category. Never returns the full dataset.
- `mark_duplicates` — persists `duplicate`/`duplicateOf`/`duplicateConfidence` on the given staging ids and dup-enriches them (copies the matched original's merchant/category into empty fields).

### Enrichment tools

Primitive tools for AI-assisted enrichment — small samples in, bulk updates out:

- `enrich_status` — compact progress summary (how many rows enriched, how many remain). With `sampleSize > 0`, also appends that many evenly-spaced CSV rows needing work (representative sampling); `sampleField` filters which empty field. Duplicate-marked rows are excluded.
- `enrich_update` — bulk SET WHERE (like SQL UPDATE) for merchant, category, account, confidence. Supports array of WHERE conditions (AND logic). Only sets empty fields. Returns per-field counts (set vs skipped). Validates `categoryId` against real budget category UUIDs.

### Code-triggered pre-steps (never advertised)

The orchestrator dispatches these via `runTool` as a phase's deterministic pre-step — no model sees them (no `TOOL_MODES` entry), but they stay on the MCP surface and dispatchable:

- `apply_account_aliases` — accounts-phase pre-step: sets `accountId` from `.capy/aliases.json` (the authoritative top layer).
- `auto_mark_duplicates` — dedup-phase pre-step: runs the finder and auto-marks high-confidence exact matches, dup-enriching each.
- `auto_enrich` — enrich-phase pre-step: matches sourceCategory→categories and resolves transfer targets in one pass. Leaves `merchant` empty for the model. (It does not map accounts — that's the accounts phase.)

### Status channel

- `report_status` — the run's sole communication channel: one short present-tense line per step. The UI drives the status line/log from these; import mode emits no prose. See INTELLIGENCE.md § Status channel.

### Budget query tools

Deterministic functions querying budget data, available to the import session:

- `list_accounts` — all accounts with balances (account-mapping targets)
- `list_categories` — all categories grouped (category UUIDs)
- `search_transactions` — fuzzy cross-field lookup over committed history, to find a cryptic description's prior merchant/category and inherit it during enrich

(`list_transactions` is **chat-only** — it is not advertised in import mode.)

## Custom Instructions

The import screen exposes an editor for `import-instructions.md` in the budget folder — separate from the chat overlay's `capy-instructions.md` so import-specific notes don't bleed into chat behavior. Users can tune agent behavior here before starting a run.

## Design Principles

- The preview area is a self-contained module. It reads/writes import files only.
- Intelligence runs as one orchestrated session from drop to merge-ready review; the user reviews and merges at the end.
- The main budget data is read-only until merge.
- All intermediate state lives in `.capy/import/` — no pollution of the budget database during import.
