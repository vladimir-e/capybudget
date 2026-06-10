# Smart Import

Drop a file, code normalizes and grounds it, the model categorizes the ambiguous remainder, you review and merge. The app is fully functional without import — it's additive.

Import requires the Anthropic or OpenAI provider. Both run the structured model calls the pipeline needs; the Claude Code CLI structured-call path is not available, so the import surface is gated off when the CLI provider (or no provider) is selected.

## Architecture: code orchestrates, the model is a stateless function

There is no import agent. **Code runs the pipeline as a deterministic state machine** and emits every status line itself. The model is called **statelessly**, each call returning structured output — no tools, no loop, no accumulated context:

1. **Mapping / extraction** (Normalizing) — CSV: headers + samples in → a `CsvMapping` out (one call; one bounded re-call when a code-side preview surfaces transform errors). Image/PDF: the bytes in → the same intermediate records a mapping would produce.
2. **Categorizing batch** — ~25 rows + their pre-attached history context in → `{ id, merchant, category, confidence }[]` out, where `category` is a budget category *name* (the model reasons over names, never ids; code maps the name back to a `categoryId`). Batches are independent, run bounded-parallel, and fail in isolation.
3. **Transfer batch** — the transfer rows + each one's direction-aware transfer context in → `{ id, account, confidence }[]` out, where `account` is a budget account *name* the model picks for the counterpart (or `""` when unsure; code maps the name back to an `accountId`). A heterogeneous sibling of the Categorizing batch — transfers carry no merchant/category, only a "From"/"To" account to resolve — run in the same phase.

Stateless calls never accumulate: mapping is tiny, each batch is bounded. The progress surface is therefore state, not prose — code always knows where the run is.

## Two on-ramps, one pipeline

User-pressed **Start Import** (the Import tab) and Capy-initiated import (chat) are two doors into the **same** staging pipeline. Capy never inserts file data into the budget directly.

- **Import tab** — a drop zone takes CSV, image, and PDF files; they're written to `.capy/import/sources/` on drop. A **Start** button becomes active once files are present. A manual drop writes only `sources/` — never `state.json` — so the screen waits for Start.
- **Chat** — when a file arrives in a chat turn, Capy calls the `start_import` tool, which copies the turn's attachments into `.capy/import/sources/`, writes a `state.json` marked `source: "chat"`, and replies pointing the user at the Import tab. The Import screen, seeing sources with no `transactions.csv` and a `state.json` it didn't write, auto-runs the orchestrator. The bytes live on the chat turn (text inlined, images base64); the handler stages from the turn's attachments, never from anything the model echoes into its arguments. When staging is already occupied — a run in flight or parked for review, or files dropped in the Import tab but not started — the tool refuses with guidance pointing at the Import tab instead of replacing that import; only a prior chat staging that never ran is replaced by a re-share.

Both on-ramps converge on the same `.capy/import/` staging and the same orchestrator. The on-ramps stay distinguishable by which artifacts exist, not by a flag the UI tracks.

## Pipeline

Four phases, all driven by code; the model is a pure function called inside two of them.

```
Reading → Normalizing → History → Categorizing
```

- **Reading** — load the source files. Near-instant.
- **Normalizing** — the mapping / extraction model call → code transforms every row → `buildStaged`. Held in memory; staging isn't written yet.
- **History** — deterministic grounding (no AI): fuzzy-match each row against the user's own history, attach context, fold in duplicate detection, fast-path the strong-signal rows. The first staging write happens here (`transactions.csv` + `context.json` together), so "`transactions.csv` exists" always means normalized **and** grounded.
- **Categorizing** — the only model batch work, over the ambiguous remainder.

Account resolution (matcher + aliases) is a step inside grounding, not a phase of its own.

The progress bar presents the four phases as two segments — **Normalizing** (Reading + Normalizing) and **Enhancing** (History + Categorizing) — each with a live "X of N" meter: the first fills from streamed extraction rows and CSV row counts (`normalize-progress` events), the second from landed classifier batches (`batch-progress`). The run control sits on the bar's right edge: **Stop** while a run is in flight, **Enrich N** when idle rows still need the classifier.

### Normalizing — unstructured is pre-processed, not branched

There is one downstream pipeline. Unstructured input is **pre-processed into the same intermediate record the CSV mapper produces** — Capy *is* the column-mapper for a source that has no columns. After Normalizing, no phase knows or cares how a row was sourced.

- **Structured (CSV):** code first locates the table's real header — a consistency scan over the parsed rows picks the row whose field count the following rows sustain (bank exports often prepend a summary preamble), and blank or duplicate header cells are renamed positionally (`Column 2`) so every column stays addressable. The model returns a `CsvMapping` (date column + format, description column(s), how amounts are structured — single signed column or split debit/credit — and formatted, how to detect expense/income/transfer, the source account, the source category column, skip rules for non-transaction rows, and an optional `headerRow` overriding the detected header when code picked wrong). Code applies it to every row. If a code-side preview of the first rows surfaces transform errors, the model gets one correction round with the errors attached; whatever the second mapping produces is final.
- **Unstructured (receipts, bank screenshots, statement scans):** the model reads the image (image bytes as base64 `image` content, PDF bytes as base64 `document` content) and emits the same intermediate records directly — `{ date, amount, type, description, sourceAccount, sourceCategory }`. The merchant it reads becomes `description` (the match key); a category it infers becomes `sourceCategory` (where a CSV's category column lands). A bank screenshot comes out indistinguishable from a transformed CSV. The extraction call **streams**: the model declares its transaction `count` first (the schema orders it before `rows`), then the rows, so the Normalizing meter fills against a real denominator while the long extraction runs — extraction is the phase's long pole and would otherwise sit visually frozen.

The resolved `merchant` / `categoryId` fields stay **empty** in both paths — those are History's and Categorizing's job. So there are no pre-filled candidates to reconcile: Capy's receipt reads ride the raw `description` + `sourceCategory` channels and get resolved by History exactly like CSV signal.

Both paths feed one builder — `buildStaged(records) → ImportTransaction[]` — that owns id assignment (sequential `imp-N`, continuing across files), the trim-45 `description`, sign/type normalization, and empty resolved fields. One staging format, one set of invariants.

### History — deterministic grounding

Code pre-computes every groundable signal so the model handles only the ambiguous remainder. For each non-transfer row:

1. **Fuzzy match** the row's description against the user's transaction history. History is indexed once per run; each historical transaction contributes two candidates — its cleaned `merchant` and its prior `note`. Matching runs on a normalized **match key** derived from the description: lowercased, whitespace-collapsed, with leading processor noise (card prefixes, gateway tags like `SQ *` / `TST*`) and trailing reference-number noise (auth codes, card tails, appended dates) stripped. New rows and historical text normalize through the same key, so signal lines up trimmed-vs-trimmed. Candidate retrieval is inverted-index driven (token + trigram), then ranked by combined token (Jaccard) / trigram (Dice) similarity. A historical transaction is one match — its best-scoring field, merchant-preferred on ties.
2. **Attach context** — the top-3 most-recent matching examples plus distilled merchant / category frequency stats, written to `context.json` keyed by row id. This is the classifier's input, never a staging column.
3. **Resolve source account** — `sourceAccount` → budget account (name match, then aliases). The resolution is written onto the row's `accountId`.
4. **Payment-leg recognition** — an outflow expense whose description both carries a payment keyword (`payment`, `pmt`, `pymt`, `epay`, `autopay`) **and** unambiguously names exactly one *other* budget account is a card payment — one leg of a transfer between the user's own accounts, which staged as an expense would inflate spending and double-count once the card's own statement is imported. The row is retyped to `transfer` with that account prefilled as the counterpart (no model involvement). Naming is containment-scored over the account's tokens/trigrams within the description, so a concatenated bank spelling (`APPLECARD` → "Apple Card") still matches; a one-short-token name like "Cash" never participates, and two accounts clearing threshold is ambiguity — no action. A recognized leg takes the transfer treatment below (no merchant/category), and one that also duplicates an existing transaction stays a transfer with `duplicate` set.
5. **Fast-path** — a row whose history is strong **and** near-unanimous (≥3 matches with ≥80% agreeing on one category) gets its merchant + categoryId assigned in code at `high` confidence. Everything else is left ambiguous for the classifier.
6. **Duplicate detection** — folded in after the steps above, so it can use the merchant each row just resolved. A row is a duplicate when it matches an existing budget transaction on amount + account + relaxed dates + resolved merchant/description. Claiming is greedy 1:1 in two passes sharing one claimed set: every row tries the exact high-confidence rules before any row may claim through the relaxed ±3-day window, so a near-date match can't steal an existing transaction another row matches exactly. Each match carries its confidence (`high` for the exact rules, `low` for the relaxed ones) onto the row as `duplicateConfidence`. Duplicates are marked complete (carrying the matched transaction's merchant, and its category when type-correct, for display) and skipped by enrichment.

For each **transfer** row, History attaches a separate sidecar instead — the imported account's own **direction-aware transfer context**, written to `transfer-context.json` keyed by row id. The counterpart is a property of the *accounts*, not the row's words, so this carries the account's matching-direction legs (an inflow row → the account's *incoming* legs, an outflow → its *outgoing*), each resolved to its counterpart account **name** via `transferPairId`:

- **`recentTransfers`** — the matching-direction legs from the last 2 months (anchored to the newest leg so a periodic cadence stays visible regardless of when the import runs), chronological, condensed to `{ account, amount }`, capped at 10.
- **`topAccounts`** — the top-3 counterpart accounts by transfer count in that direction, with counts.

A counterpart that's archived, gone, or the account itself is dropped (the model can't pick an id it won't see in the dropdown). An account with no matching-direction history gets no entry — the model leaves the counterpart blank. Recognized payment legs aside, grounding sets no `targetAccountId`; the model picks it in Categorizing.

History reports the payoff: *"47 of 77 resolved from your history · 4 duplicates."*

### Categorizing — a batched classifier

The only model batch work, over the rows that still fail the `needsEnrich` predicate (see **Staging & resume**). Rows are split into batches of ~25 and run with bounded parallelism (4 at a time). **The model reasons over category names, never ids** — opaque UUIDs were the easy-wrong signal that let coarse bank labels beat rich history. Each batch is one tool-less structured call whose prompt embeds:

- the active category list **by name + group**, split into income vs expense, no ids,
- each row's raw description, amount, type, and `sourceCategory`,
- each row's distilled history context — examples and frequency stats **by category name**, with any dead/archived id dropped rather than shown (the dominant signal stays a real, usable category).

The prompt leads with the user's own history as the **primary** signal: when the merchant appears in history, the model strongly prefers the category they've used for it (weighing recency, frequency, amount). `sourceCategory` is demoted to a weak hint, and a coarse value like "Other" is explicitly framed as *not* a category — never mapped to "Other Income." Each row comes back with a merchant, a category name, and a confidence (`high` for an obvious match, `low` for a reasonable inference).

Code maps each returned name → a `categoryId` within the row's **type-appropriate** categories (case-insensitive exact match; income names resolve only against income categories, expense only against expense — so an income category can't land on an expense). Results are filtered to ids in that batch; a name that matches no type-appropriate category leaves the row uncategorized (it keeps its cleaned merchant and stays re-enrichable). Resolved rows are merged into staging — filling only empty fields, so a re-run never clobbers a hand-mapped or already-landed value. Each landed batch is persisted to `transactions.csv` immediately, not buffered to the end. There is **no auto-retry**: a batch that throws is logged and skipped, its rows left incomplete; the user-initiated re-run is the retry.

**Transfers** participate here too, but only to resolve their counterpart, and only when they carry transfer context and have no counterpart yet. Their batch is a separate call with its own small schema (a heterogeneous task — they get no merchant or category): the transfer rows plus each one's `recentTransfers` / `topAccounts` go in, and `{ id, account, confidence }` comes back per row, where `account` is a counterpart account **name** the model picks from the context (using the description + amount + the recent/periodic pattern) or `""` when unsure. Code maps that name → an `accountId` (case-insensitive against current non-archived accounts), validates it isn't the row's own account, and writes it to `targetAccountId`. An unknown name, an empty pick, or the row's own account leaves the counterpart blank — a wrong or blank answer degrades to "leave it for the user", never a bad pairing. Transfers are few, so this is typically one batch; it runs in the same bounded-parallel pool as the category batches.

## Data model

The staging row (`ImportTransaction`) and the intermediate `StagedRecord` it's built from are specified in `DATA_MODEL.md`. The import-specific invariants:

- **`description` = raw text trimmed to 45 chars**, set in `buildStaged` for both paths. This is the single canonical form used both for matching (history is already trimmed, so matching is trimmed-vs-trimmed consistent) and for `note` at merge. Truncation drops trailing reference-number noise. There is no separate full-raw field.
- **`merchant` / `accountId` / `categoryId` start empty** — they're populated by grounding and the classifier, never by the source adapter.
- **`duplicate`** marks a row that matches an existing budget transaction; **`duplicateConfidence`** carries the match tier (`high` from the exact rules, `low` from the relaxed date window) so the preview can flag a speculative dup for review.
- **History context lives in `context.json`** keyed by row id — ephemeral classifier input, never a `transactions.csv` column and never persisted to `Transaction`.
- **Confidence** is `high` / `low` — `high` from fast-path and dedup, the model's call otherwise; low rows are flagged in preview.

## Staging & resume

`.capy/import/` is the **single source of truth for resume**. Where the user lands on reopen is a pure function of which artifacts exist — there is no separate crash state.

```
.capy/import/
  sources/              # original files (read-only to the engine)
  transactions.csv      # normalized staging (written from History on)
  context.json          # per-row history signals (written during History)
  transfer-context.json # per-transfer-row direction-aware history (written during History)
  state.json            # phase + metadata
```

- **No `transactions.csv`** (the run died during Reading / Normalizing / History) → file-attach screen; stale `sources/` is cleared. Those phases are seconds of code — nothing to recover.
- **`transactions.csv` exists** (died or stopped during Categorizing) → land on the preview with whatever enrichment was written; Enrich is ready (user-initiated, no auto-fire). `start()` notices the existing rows and resumes at Categorizing over the remainder.

**Interrupt, crash-recovery, and resume are one code path.** Stop is a crash you chose — all three leave identical persisted state and resume by re-running idempotent enrichment.

**One predicate gates category enrichment:** `needsEnrich = !duplicate && (!merchant || !categoryId)` (transfers are exempt — they get no merchant/category). It covers fast-pathed rows, duplicates, hand-mapped rows, batches that already landed, and re-runs after a partial — no special cases. The "import 1000, do it myself" flow falls straight out: map rows in the UI, those rows fail the predicate, Enrich does only what's left. **Transfers have a sibling gate** for the counterpart: `needsTransferEnrich = transfer && !duplicate && !targetAccountId && hasTransferContext` — idempotent the same way, so once the counterpart is set (by the model or by hand) the row drops out and a re-run never re-asks.

**Stop** (awaitable) requests a clean stop: no new batches dispatch, the in-flight one finishes its write, and the returned promise resolves once no further write is pending — which is what lets **Cancel** safely discard staging afterward. **Cancel** = stop + clear `.capy/import/`. Re-running on staged data is idempotent.

## Errors

- **No transaction data** (a selfie, a non-financial document): the extraction call returns a structured `{ error: "no_data" }`. The orchestrator logs *"No transaction data found,"* writes no staging, and returns to file-attach. When several files are imported together, a single no-data file is skipped with a warning rather than failing the run; only all-empty is terminal.
- **Batch failure:** no auto-retry. Logged; the batch's rows stay incomplete (they fail the predicate) and the run moves on. The idempotent re-run is the retry.
- **All duplicates:** no special handling — every row lands unselected and Merge is disabled until the user selects something.

## Preview & merge

A self-contained module operating on staging only — no budget-data dependency until merge.

- **Live during a run, read-only.** Rows render beneath the progress bar as soon as they exist and fill in live as batches land; the table is read-only while a run is in flight and **Merge is disabled** until it settles. Stop/Enrich live in the progress section's header; the floating action bar carries the selection count, the sum, and **Merge**.
- **Account mapping** lives in a Map-accounts dialog the table's ACCOUNT cells open — one row per imported account, each mapping to an existing budget account or marked for creation (the default); edits apply live. The ACCOUNT cell shows only the mapped *target* name, with a "new" tag when merge would create the account — the raw imported → target relationship is visible in the dialog. The merge dialog is confirmation-only: row count, sum, and how many accounts merge will create. Aliases stored in `.capy/aliases.json` survive across imports and pre-populate the mapping; they're persisted at merge.
- **Run notes** sit in one compact panel above the table: a duplicates line splitting certain matches from possible (close-date) ones — which also carry an amber badge in the table prompting review — and an issues line counting low-confidence and uncategorized rows once the run settles. Duplicates land unselected.
- **Transfers** show an account dropdown for the counterpart, pre-filled when grounding or the model resolved it. The dropdown stays the standard account list (never reranked — account ordering is consistent app-wide); a row whose counterpart is still unset gets an outline on the dropdown so it's easy to spot in the preview, with the placeholder ("From account" for an inflow, "To account" for an outflow) as the only wording.
- **Transaction table** — full CRUD, multi-select (unselect to skip), search, inline editing; the same interaction patterns as the main transactions view. Edits write back to staging.
- **Merge** converts the selected rows into budget transactions: creates unmapped source accounts, links transfer pairs (same date, opposite amounts, different accounts), and bulk-inserts. The field mapping:

| Staging field | `Transaction` field |
|---|---|
| `description` (trimmed) | `note` |
| `merchant` (cleaned) | `merchant` |
| `categoryId` | `categoryId` (empty for transfers) |
| `accountId` (resolved) | `accountId` |

`note` is the trimmed `description`, period. `merchant` on `Transaction` is reserved for the cleaned name — the two are never copied into each other.

## Import log

On a successful merge, an entry is appended to the import log in the budget folder, recording the source file names, the date, and quick stats (transaction count, accounts created, date range). The drop zone checks new file names against the last 20 entries and shows an advisory amber warning when a name was imported before — the user can still proceed. Merge clears `.capy/import/` after writing the log entry. Capy can read the log for audit queries.

## Custom instructions

The Import tab carries a per-run hints field (format quirks, a default source account) and persists free-text notes to `import-instructions.md` in the budget folder — separate from the chat overlay's `capy-instructions.md` so import-tuning notes don't bleed into chat behavior. The hints ride into the import session's system prompt, the one channel both stateless calls (mapping / extraction and Categorizing) see.

## Design principles

- The preview is a self-contained module — it reads and writes staging only.
- The model is a stateless function called at two points; code drives everything between and around them.
- The main budget data is read-only until merge.
- All intermediate state lives in `.capy/import/` — no pollution of the budget database during import.
