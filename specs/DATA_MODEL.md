# Data Model

All data lives in a user-chosen folder as plain CSV files. A `budget.json` metadata file identifies the folder as a Capy Budget.

## Folder Structure

```
~/MyBudget/
  budget.json            ← metadata: schema version, name, currency, formatting
  accounts.csv
  categories.csv
  transactions.csv
```

## budget.json

```json
{
  "schemaVersion": 3,
  "name": "My Budget",
  "currency": "USD",
  "currencyDecimals": 2,
  "currencySymbolPosition": "before",
  "createdAt": "2026-03-07T12:00:00.000Z",
  "lastModified": "2026-03-07T12:00:00.000Z"
}
```

The schema version enables future migrations. On load, the app checks the version and runs any necessary transformations before proceeding.

The `currency` field selects the display symbol; all amounts are integers in the minor unit regardless. `currencyDecimals` (0–2) and `currencySymbolPosition` (`before` · `after` · `off`) are user-tunable display knobs, seeded from the currency's curated defaults — `{ 0, after }` for RUB, `{ 2, before }` for USD — so a user whose exact currency isn't listed can pick a near one and match their real formatting. Decimals only rounds the rendered figure; money on disk stays ×100, so 2 is the ceiling — a third decimal could only ever render zero, and a stored value above 2 is clamped to 2 on load. Both knobs are seeded from the currency's defaults and re-seeded on a currency switch — changing currency lands on the new currency's conventional formatting rather than carrying the prior tweaks; a "reset to defaults" control restores the current currency's defaults on demand (e.g. after manual tweaks). `currency`, `currencyDecimals`, and `currencySymbolPosition` are additive `budget.json` fields with no schema bump; a budget written before they existed backfills from the currency's defaults on load.

## Accounts

Every financial entity is an account.

| Field                  | Type    | Notes                                                             |
|------------------------|---------|-------------------------------------------------------------------|
| `id`                   | string  | UUID, client-generated                                            |
| `name`                 | string  | User-defined label (e.g. "BofA Checking", "Cash Wallet")          |
| `type`                 | enum    | `cash · checking · savings · credit_card · loan · asset · crypto` |
| `archived`             | boolean | Hidden from the sidebar when true. Archiving requires a zero derived balance (see Referential Integrity), so it has no effect on current net worth, but the account's transactions still count toward the historical net-worth series at the points where it carried a balance. |
| `excludeFromNetWorth`  | boolean | Excluded from Net Worth calculations when true                    |
| `sortOrder`            | integer | Display ordering                                                  |
| `createdAt`            | string  | ISO 8601                                                          |

**No stored balance.** Balance is always derived: sum of all transactions where `accountId` matches. See Architecture for rationale.

**Opening balance.** When creating an account with an existing balance, generate an "Opening Balance" income transaction dated to the account's `createdAt`. This is the only way balances enter the system — through transactions.

## Categories

Fully user-manageable. Sensible defaults prepopulated on first launch.

| Field       | Type             | Notes                                                             |
|-------------|------------------|-------------------------------------------------------------------|
| `id`        | string           | UUID, client-generated                                            |
| `name`      | string           | Display name                                                      |
| `group`     | string           | Logical grouping (see below)                                      |
| `archived`  | boolean          | Hidden under "Archived" group                                     |
| `sortOrder` | integer          | Display ordering within group                                     |
| `assigned`  | integer \| null  | Explicit monthly budget in cents. `null` = no explicit budget. `0` = tracked at zero. Single piece of mutable current state — applies to every month. The only stored budget input. |

**Budget target.** The figure a category's spend is tracked against is `assigned ?? implicitTarget`. `assigned` is the explicit budget above; `implicitTarget` is derived from the category's spending history — the heavier of last month and a reference average over the months the budget-wide `basis` selects (the divisor is the count of those months with non-zero spend, so a dormant month doesn't dilute the figure), `null` when none of the reference months had spend. Last month is always the single month before the viewed one, independent of `basis`. Implicit targets are **computed at render and never stored** — there is no derived-target column and no migration. `assigned` is the only budget field that touches CSV.

### Default Category Groups

| Group          | Categories                                                                          |
|----------------|-------------------------------------------------------------------------------------|
| Income         | Paycheck, Other Income                                                              |
| Fixed          | Housing, Bills & Utilities, Subscriptions                                           |
| Daily Living   | Groceries, Dining Out, Transportation                                               |
| Personal       | Alcohol & Smoking, Health & Beauty, Clothing, Fun & Hobbies, Allowances, Education & Business, Gifts & Giving |
| Irregular      | Housekeeping & Maintenance, Big Purchases, Travel, Taxes & Fees                     |

Groups can be created, renamed, and reordered by the user.

## Transactions

The core entity. Every financial event is a transaction.

| Field            | Type    | Notes                                                           |
|------------------|---------|-----------------------------------------------------------------|
| `id`             | string  | UUID, client-generated                                          |
| `datetime`       | string  | ISO 8601. Time preserves entry order within a day.              |
| `type`           | enum    | `income · expense · transfer`                                   |
| `amount`         | integer | **Signed** cents. Negative = outflow, positive = inflow.        |
| `categoryId`     | string  | UUID FK to categories. **Empty for transfers.**                 |
| `accountId`      | string  | UUID FK to accounts. The account this transaction belongs to.   |
| `transferPairId` | string  | UUID of the paired transaction. Empty for non-transfers.        |
| `merchant`       | string  | Optional. Who you paid or received from.                        |
| `note`           | string  | Optional. Additional context.                                   |
| `createdAt`      | string  | ISO 8601                                                        |

### Sign Convention

- **Expense**: amount is negative. Reduces account balance.
- **Income**: amount is positive. Increases account balance.
- **Transfer outflow leg**: amount is negative on source account.
- **Transfer inflow leg**: amount is positive on destination account.

Zero-amount transactions are allowed — useful for tracking non-monetary events or placeholder entries.

An account's balance = `sum(amount)` for all its transactions. No special cases.

### Transfer Architecture

A transfer is **two linked transactions** with mutual `transferPairId` references.

- Creating a transfer creates both legs atomically. User specifies source account, destination account, and amount. The system creates:
  1. Outflow transaction (negative amount) on the source account
  2. Inflow transaction (positive amount) on the destination account
  3. Each leg's `transferPairId` points to the other's `id`
- **Transfers have no category** (`categoryId = ""`). Enforced at schema level. Transfers move money — they are not spending.
- Deleting either leg **cascades** to delete both.
- Updating a transfer **propagates** amount and date changes to the paired transaction.
- **Type changes between income ↔ expense are allowed.** Changing to/from transfer is NOT — delete and recreate. This avoids orphaned pair references.

## Referential Integrity

| Operation         | Rule                                                              |
|-------------------|-------------------------------------------------------------------|
| Delete account    | **Blocked** if account has more than one transaction              |
| Archive account   | **Blocked** if derived balance is non-zero                        |
| Update transfer   | **Propagates** `amount` and `date` to paired transaction          |
| Delete transfer   | **Cascades** — deletes paired transaction                         |
| Delete category   | **Clears** `categoryId` on all referencing transactions           |
| Archive category  | No cascade — transactions keep the reference, display still works |

## Schema Migrations

The `schemaVersion` field in `budget.json` drives migrations. On load, the app checks the version and runs sequential migration functions to bring the data up to the current schema. Migrations transform CSV structure in-place, then `budget.json` is rewritten with the new version.

Each migration `n → n+1` is a pure-ish function on the budget folder, idempotent (re-running on already-migrated data is a no-op). Migrations live in `src/services/budget-migrations.ts`.

### History

| From → To | Change |
|-----------|--------|
| 1 → 2     | Add `excludeFromNetWorth` column to accounts.csv (default `false`). |
| 2 → 3     | Add `assigned` column to categories.csv (empty cell = `null` = untracked). |

## Import Staging

Smart Import works in a scratch area under the budget folder, `.capy/import/`. None of it is budget data — it's intermediate state that exists only between dropping files and merging, and is cleared on merge or cancel. The pipeline that produces it is specified in `IMPORT.md`; this is its data shape.

```
.capy/import/
  sources/              # original files (CSV, image, PDF)
  transactions.csv      # the staged rows
  context.json          # per-row history signals
  transfer-context.json # per-transfer-row direction-aware history
  state.json            # phase + run metadata
```

### Staged record

Both normalization paths (a `CsvMapping` applied to a CSV, or a model reading an image/PDF) converge on one intermediate record before it's built into a staged row:

| Field           | Type    | Notes                                                        |
|-----------------|---------|--------------------------------------------------------------|
| `date`          | string  | `YYYY-MM-DD`                                                 |
| `amount`        | integer | **Signed** cents (negative = outflow) — sign already resolved |
| `type`          | enum    | `expense · income · transfer`                                |
| `description`   | string  | Raw merchant text, untrimmed at this stage                   |
| `sourceAccount` | string  | Raw account string from the source                           |
| `sourceCategory`| string  | Raw category string from the source (empty when none)        |

`buildStaged` is the single sink: it assigns ids and trims `description` to produce the staged row.

### Staged row (`transactions.csv`)

| Field               | Type    | Notes                                                                                  |
|---------------------|---------|----------------------------------------------------------------------------------------|
| `id`                | string  | Sequential `imp-N`, continuing across multi-file imports                                |
| `date`              | string  | `YYYY-MM-DD`                                                                            |
| `description`       | string  | **Raw text trimmed to 45 chars** — the canonical form for both history matching and `note` at merge. Truncation drops trailing reference-number noise; there is no separate full-raw field. |
| `amount`            | integer | Signed cents (negative = expense, positive = income)                                   |
| `type`              | enum    | `expense · income · transfer`                                                           |
| `sourceAccount`     | string  | Raw account string — resolved to `accountId` during grounding                          |
| `sourceCategory`    | string  | Raw category string from the source — a weak hint to the classifier, never resolved to a category in code |
| `merchant`          | string  | Cleaned merchant name. Empty until grounding or the classifier fills it                 |
| `accountId`         | string  | Resolved budget account UUID (may be empty)                                             |
| `targetAccountId`   | string  | For transfers: the counterpart account UUID. Empty until the model picks it in Categorizing (or the user sets it); empty = unmatched |
| `categoryId`        | string  | Resolved budget category UUID. Empty until grounding or the classifier fills it         |
| `categoryConfidence`| string  | `high` · `low` · `""` — set alongside `categoryId`                                       |
| `duplicate`         | boolean | True when the row matches an existing budget transaction — skipped by enrichment, unselected at merge |
| `duplicateConfidence`| string | `high` · `low` · `""` — the dup match tier; `low` (relaxed date window) renders as a possible duplicate to review |

There is no `memo` field. At merge, `note` is the trimmed `description` and nothing else; `merchant` on `Transaction` is reserved for the cleaned name.

### History context (`context.json`)

Ephemeral classifier input written during grounding, keyed by row id. It feeds the Categorizing call and is never a `transactions.csv` column or persisted to `Transaction`. Rows with no historical match carry no entry.

```ts
Record<string /* row id */, {
  examples: {            // top-3 most-recent matching transactions
    date: string
    merchant: string
    note: string
    categoryId: string
    amount: number
  }[]
  merchantStats: { name: string; count: number }[]   // merchant frequency among matches
  categoryStats: { name: string; count: number }[]   // categoryId frequency among matches
}>
```

### Transfer context (`transfer-context.json`)

Ephemeral input for the transfer-counterpart call, written during grounding, keyed by row id — transfer rows only, and only those whose imported account has matching-direction transfer history. The counterpart is a property of the *accounts*, so this carries the account's own legs in the row's direction (inflow → incoming legs, outflow → outgoing), each by counterpart account **name**. Like `context.json`, it never becomes a `transactions.csv` column or touches `Transaction`.

```ts
Record<string /* row id */, {
  recentTransfers: { account: string; amount: number }[]  // last 2 months, chronological, ≤10
  topAccounts: { account: string; count: number }[]       // top-3 counterparts by count in this direction
}>
```

### Run state (`state.json`)

```ts
{
  phase: ImportPhase           // reading · normalizing · history · categorizing · done · error · idle
  rowCount?: number            // set once staging is written
  updatedAt: string            // ISO timestamp of the last write
  source?: "chat"              // present when the chat on-ramp staged the run; its absence marks a manual Import-tab drop
}
```

### Aliases (`.capy/aliases.json`)

Survives across imports, so returning users don't re-map the same accounts. Persisted at merge.

```ts
{ accounts: Record<string /* sourceAccount */, string /* accountId | "__create__" */> }
```
