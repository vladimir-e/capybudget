# Smart Import

Drop a file, intelligence normalizes it, you review and merge. Supports CSV exports (bank, YNAB), PDFs, and screenshots.

## Pipeline

Import is a multi-stage pipeline with checkpoints. Each stage produces files in `.capy/imports/{importId}/`. The user controls progression — no stage runs without explicit action.

```
Drop file → Normalize → Preview → Map → Enrich → Review → Merge
```

## Storage

Import working data lives in `.capy/imports/{importId}/`. Transaction data uses CSV for token efficiency and resumability — a partial CSV is still valid rows. Small structural data (metadata, mappings) uses JSON.

Each import has a `meta.json` tracking source format, stage, row counts, and processing progress. This enables session resumability — a new session reads meta, sees where the previous one stopped, and continues.

## Stages

### 1. Normalize

Intelligence reads the dropped file and extracts transactions into a uniform CSV: `raw-transactions.csv`.

Columns: `id, date, description, amount, type, sourceAccount, sourceCategory, memo`

`sourceAccount` and `sourceCategory` are raw strings from the file — not matched to anything yet. For screenshots and PDFs, intelligence does OCR-level interpretation. For YNAB exports, it maps known column layouts. For bank CSVs, it infers structure from headers.

Processing happens in batches (~200 rows) with progress tracked in meta. If a session ends mid-normalize, the next session appends from where it left off.

### 2. Preview

Pure UI. The preview area renders `raw-transactions.csv` as an editable table using the same interaction patterns as the main transactions view. User fixes OCR errors, dates, amounts. Changes write back to the file.

### 3. Map

Intelligence matches `sourceAccount` and `sourceCategory` strings to existing budget entities.

Produces `account-mapping.json` and `category-mapping.json`. Each entry is one of:
- **existing** — matched to a known account/category by ID
- **create** — new entity to be created on merge
- **skip** — excluded from import

The UI shows a mapping section where the user confirms or overrides each match. Dropdowns let the user switch between create and merge-into-existing.

### 4. Enrich (Magic Button)

The heaviest stage. User triggers it explicitly. Intelligence processes transactions in batches, using `search_merchants` to fuzzy-match bank descriptions against existing transaction payees.

`search_merchants` is the core tool — it takes a query string, searches existing payees by fuzzy match, and returns the typical category assignment and frequency. This solves both merchant normalization and auto-categorization in one lookup.

Produces `enriched-transactions.csv` adding columns: `merchant, merchantConfidence, accountId, categoryId, categoryConfidence`

Confidence levels (`high`, `medium`, `low`, `none`) let the UI highlight what needs attention.

### 5. Transfer Detection

Runs as part of enrichment or as a separate pass. Detection heuristics in order of confidence:

1. **Explicit** — YNAB-style `"Transfer : AccountName"` payees
2. **Exact match** — same amount, same date, opposite signs, different accounts
3. **Near-date** — same amount, ±2 days, different accounts (bank posting delays)

Produces `transfer-pairs.json` with three buckets: confirmed pairs, ambiguous (multiple candidates), and unpaired. The UI shows each bucket for user resolution.

### 6. Review

Pure UI. User sees the fully enriched data — merchants, categories, transfer pairs, confidence indicators. They can:
- Edit any transaction inline
- Toggle transactions to skip (grayed out, moved to bottom)
- Resolve ambiguous transfers
- Override category/merchant assignments

### 7. Merge

Pure JavaScript, no intelligence. Reads the final enriched data and confirmed mappings:
1. Creates new accounts and categories from mapping entries marked `create`
2. Creates transactions with resolved account/category IDs
3. Links transfer pairs via `transferPairId`

A bulk create operation handles the transaction volume.

## Intelligence Tools

| Tool | Purpose |
|---|---|
| `write_import_file` | Write CSV/JSON to the import working directory |
| `read_import_file` | Read import files with pagination (offset, limit) |
| `count_import_rows` | Row count for resume checkpoints |
| `write_import_meta` | Write/update import metadata and status |
| `read_import_meta` | Read import metadata for session resumption |
| `search_merchants` | Fuzzy-match bank descriptions against existing payees, returns typical category and frequency |

## Preview Area

The preview area is an independent front-end module. It operates entirely on import files — no direct budget data dependency until merge.

Key properties:
- Same table UX as the main transactions view (inline editing, sorting, filtering)
- Mapping section at the top for account/category resolution
- Magic button triggers intelligence enrichment stages
- Skip toggles move transactions to a grayed-out section at the bottom
- Merge button is the final action — only enabled when all mappings are resolved

## Resumability

Large imports (thousands of rows) may span multiple intelligence sessions. The system handles this through:
- CSV append semantics — each batch appends rows, never rewrites
- Meta tracking — row counts and processing stage persisted after each batch
- Stateless sessions — intelligence reads meta on start, resumes from last checkpoint
