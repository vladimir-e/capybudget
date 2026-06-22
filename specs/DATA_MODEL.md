# Data Model

All data lives in a user-chosen folder as plain CSV files. A `budget.json` metadata file identifies the folder as a Capy Budget.

## Folder Structure

```
~/MyBudget/
  budget.json            ← metadata: schema version, name, currency settings
  accounts.csv
  categories.csv
  transactions.csv
```

## budget.json

```json
{
  "schemaVersion": 4,
  "name": "My Budget",
  "defaultCurrency": "USD",
  "currencies": {
    "USD": { "decimals": 2, "symbolPosition": "before" }
  },
  "createdAt": "2026-03-07T12:00:00.000Z",
  "lastModified": "2026-03-07T12:00:00.000Z"
}
```

The schema version enables future migrations. On load, the app checks the version and runs any necessary transformations before proceeding.

### Currency settings

Currency lives in two fields: `defaultCurrency`, the ISO code everything rolls up into and the value an account or transaction takes when it carries none of its own; and `currencies`, a map keyed by ISO code holding each currency's settings. **The default currency is just another entry of the same shape** — no split between "the default's settings here, foreign settings there."

Each entry carries display settings: `decimals` (0–2) and `symbolPosition` (`before` · `after` · `off`). A non-default entry additionally carries its `rate` against the default and a `rateSource` tag (`manual` · `seed`) recording where the rate came from; the default entry carries neither — it is the base, an implicit rate of 1.0. `rate` is `rate(currency → default)`: the value of one unit of the currency in default units. Money is integer ×100 for every currency, so the same ratio values cents: `defaultCents = round(nativeCents × rate)`.

A currency earns a settings row once an account uses it, but its entry is kept even after the last account on it is deleted — re-adding the currency restores its rate and display settings intact (persist-when-empty). The entry is seeded lazily from the currency's display defaults the first time it is used; the rows shown are gated on in-use currencies, while the map retains unused entries.

### Exchange rates

A currency's rate against the default is resolved through a fallback chain, yielding the rate **and** a provenance tag the UI shows (whose number it is):

1. **`manual`** — the user's override (`rate` with `rateSource: "manual"`).
2. **`seed`** — derived from a bundled, USD-anchored seed table by division: `rate(X → D) = usdRates[D] / usdRates[X]`, where `usdRates[c]` is units of `c` per 1 USD. This handles any base, including a non-USD default. `rate(X → X) = 1`.
3. **`unset`** — 1.0 with a quiet "rate unset" state, when the currency is absent from the seed table.

The seed table ships as `{ base: "USD", rates: { CODE: numberPerUSD, … } }` — deliberately the same shape the checkpoint-3 rate Lambda will serve, so it later becomes the offline floor under the fetched rates with no reshape. Its values are overridable fallbacks (reasonable mid-market figures), not live data. A `todayRates` map of every currency in the budget keyed to its resolved rate against the default feeds the analytics converter; flows value at the rate stamped on each transaction, balances at today's resolved rate.

Display settings are seeded from the currency's curated defaults — `{ 0, after }` for RUB, `{ 2, before }` for USD — so a user whose exact currency isn't listed can pick a near one and match their real formatting. The symbol is currency-driven; all amounts are integers in the minor unit regardless. Decimals only rounds the rendered figure; money on disk stays ×100, so 2 is the ceiling — a third decimal could only ever render zero, and a stored value above 2 is clamped to 2 on load. The default entry's knobs are re-seeded on a currency switch — changing the default lands on the new currency's conventional formatting rather than carrying the prior tweaks; a "reset to defaults" control restores the current currency's defaults on demand (e.g. after manual tweaks).

The currency settings carry no schema bump: they are normalized at load time, not by a numbered migration. A budget written before they existed — whether missing them entirely or carrying the older flat `currency` / `currencyDecimals` / `currencySymbolPosition` fields — is read into the unified shape, lifting any flat fields into the default entry and backfilling missing knobs from the currency's defaults. The normalized shape is written back on the next save, which rewrites every existing budget.json (single-currency ones included); only the shape moves, so the rendered numbers and formatting are unchanged.

### Switching the default currency

Changing the default currency is a **value-preserving rebase**: native amounts are never rewritten — only the unit of account moves. A single-currency budget (no foreign account) is relabeled to the new currency with every stored number unchanged: a balance of 1000 stays 1000, just read in the new currency. A multi-currency budget rescales every stored `fxRate` by the constant `k = rate(OLD → NEW)` — the old default valued in the new — so each foreign flow's value scales uniformly into the new unit; a flow with no stamp (an old-default-currency flow at an implicit 1.0) becomes `k`. The exception is transactions already in the new currency: they are naturalized to face value, their stamp cleared, because the home currency has no exchange rate with itself — a $1000 deposit must read $1000 once dollars are the default, whatever historical rate it once carried. A transfer's two legs are separate transactions, so each rebases by its own account: a leg in the new currency clears, a leg in any other currency rescales by `k`. The rate map is re-expressed against the new default — the new currency becomes the rate-free base, the old default gains a rate of `k`, and each surviving foreign manual rate carries across as `rate × k` (seed-sourced entries re-resolve from the table). Holdings then value at today's resolved rates relative to the new default.

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
| `currency`             | string  | ISO 4217 code the account holds natively. Set when the account is created, defaulting to the budget default; editable only while the account has no transactions, then locked. Balances roll up into the default at conversion time; a default-currency account converts as the identity. |

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
| `fxRate`         | number  | Optional. The account's native→default rate stamped the day the transaction happened, so flows never re-rate as rates move. Empty = a default-currency transaction = an implicit rate of 1.0. Amounts are always stored in the account's native currency; this rate values them in the default at read time. A transfer's two legs each carry their own `fxRate` (see Transfer Architecture § Cross-currency transfers). |

### Sign Convention

- **Expense**: amount is negative. Reduces account balance.
- **Income**: amount is positive. Increases account balance.
- **Transfer outflow leg**: amount is negative on source account.
- **Transfer inflow leg**: amount is positive on destination account.

Zero-amount transactions are allowed — useful for tracking non-monetary events or placeholder entries.

An account's balance = `sum(amount)` for all its transactions. No special cases.

### Stamping a flow's rate

A flow's `fxRate` is the rate on the day it happened — frozen history, not a live figure. It is set once at entry from the account's native→default rate (cleared when the account is the default currency), and an ordinary edit (amount, merchant, date, note) carries the stored stamp through verbatim, never re-rating to today. The one edit that changes a flow's currency is **moving it to a different account**: that re-stamps the `fxRate` at the target account's rate — cleared when the target holds the default currency. A bulk move re-stamps every moved flow the same way. (A transfer's per-leg rates follow the same principle: an edit that does not change the transfer's shape preserves both legs' historical stamps; see Transfer Architecture § Cross-currency transfers.)

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

#### Cross-currency transfers

When the two accounts hold different currencies, the legs cannot be equal and opposite — $100 leaving a USD account does not arrive as $100 in a EUR account. So a cross-currency transfer carries **two independent native amounts**, one per leg in that account's currency, and **each leg stamps its own `fxRate`** (its native→default rate), exactly as a standalone flow does. The form shows a second "received" amount field, prefilled from the display cross-rate and fully editable (the user enters what actually landed). A same-currency transfer is unchanged: one amount, mirrored, both legs sharing the one stamped rate.

Per-leg rate rules:

- A leg in the **default currency** leaves `fxRate` empty (an implicit 1.0).
- When **exactly one** leg is the default, the foreign leg's rate is **derived from the two amounts** — the real rate the transfer executed at, more accurate than the table. From default→foreign, `toRate = fromAmount / toAmount`; from foreign→default, `fromRate = toAmount / fromAmount`.
- When **neither** leg is the default, the amounts pin the X↔Y rate but not either →default rate, so each leg stamps its own resolver rate.

The two legs net to ~0 in the default currency at the stamped rates (any residue is the genuine FX spread), so a cross-currency transfer fabricates no net-worth gain or loss. Editing a transfer re-stamps both legs from the edited amounts and currencies.

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
| 3 → 4     | Add `currency` column to accounts.csv (stamped with the budget default for every existing account) and `fxRate` column to transactions.csv (empty everywhere). Behavior-identical: every account lands in the default currency, every transaction has an implicit 1.0 rate, so a single-currency budget reads back unchanged. |

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
