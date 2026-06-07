# Data Model

All data lives in a user-chosen folder as plain CSV files. A `budget.json` metadata file identifies the folder as a Capy Budget.

## Folder Structure

```
~/MyBudget/
  budget.json            ← metadata: schema version, name, currency
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
  "createdAt": "2026-03-07T12:00:00.000Z",
  "lastModified": "2026-03-07T12:00:00.000Z"
}
```

The schema version enables future migrations. On load, the app checks the version and runs any necessary transformations before proceeding.

The `currency` field determines minor-unit precision for display (2 for USD/EUR, 0 for JPY, etc.). All amounts are integers in the minor unit.

## Accounts

Every financial entity is an account.

| Field                  | Type    | Notes                                                             |
|------------------------|---------|-------------------------------------------------------------------|
| `id`                   | string  | UUID, client-generated                                            |
| `name`                 | string  | User-defined label (e.g. "BofA Checking", "Cash Wallet")          |
| `type`                 | enum    | `cash · checking · savings · credit_card · loan · asset · crypto` |
| `archived`             | boolean | Excluded from sidebar and net worth when true                     |
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
  sources/          # original files (CSV, image, PDF)
  transactions.csv  # the staged rows
  context.json      # per-row history signals
  state.json        # phase + run metadata
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
| `sourceCategory`    | string  | Raw category string — resolved to `categoryId` during grounding                        |
| `merchant`          | string  | Cleaned merchant name. Empty until grounding or the classifier fills it                 |
| `accountId`         | string  | Resolved budget account UUID (may be empty)                                             |
| `targetAccountId`   | string  | For transfers: the other account (empty = unmatched)                                    |
| `categoryId`        | string  | Resolved budget category UUID. Empty until grounding or the classifier fills it         |
| `categoryConfidence`| string  | `high` · `low` · `""` — set alongside `categoryId`                                       |
| `duplicate`         | boolean | True when the row matches an existing budget transaction — skipped by enrichment, unselected at merge |

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
