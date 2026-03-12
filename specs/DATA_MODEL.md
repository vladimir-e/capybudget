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
  "schemaVersion": 1,
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

| Field       | Type    | Notes                                                             |
|-------------|---------|-------------------------------------------------------------------|
| `id`        | string  | UUID, client-generated                                            |
| `name`      | string  | User-defined label (e.g. "BofA Checking", "Cash Wallet")         |
| `type`      | enum    | `cash · checking · savings · credit_card · loan · asset · crypto` |
| `archived`  | boolean | Excluded from sidebar and net worth when true                     |
| `sortOrder` | integer | Display ordering                                                  |
| `createdAt` | string  | ISO 8601                                                          |

**No stored balance.** Balance is always derived: sum of all transactions where `accountId` matches. See Architecture for rationale.

**Opening balance.** When creating an account with an existing balance, generate an "Opening Balance" income transaction dated to the account's `createdAt`. This is the only way balances enter the system — through transactions.

## Categories

Fully user-manageable. Sensible defaults prepopulated on first launch.

| Field       | Type    | Notes                            |
|-------------|---------|----------------------------------|
| `id`        | string  | UUID, client-generated           |
| `name`      | string  | Display name                     |
| `group`     | string  | Logical grouping (see below)     |
| `archived`  | boolean | Hidden under "Archived" group    |
| `sortOrder` | integer | Display ordering within group    |

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

The `schemaVersion` field in `budget.json` drives migrations. On load, the app checks the version and runs sequential migration functions to bring the data up to the current schema. Migrations transform CSV structure in-place.
