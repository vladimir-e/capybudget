# Data Model

All data lives in a user-chosen folder as plain CSV files. A `budget.json` metadata file identifies the folder as a Capy Budget.

## Folder Structure

```
~/MyBudget/
  budget.json            ← metadata: schema version, name, timestamps
  accounts.csv
  categories.csv
  transactions.csv
```

## budget.json

```json
{
  "schemaVersion": 1,
  "name": "My Budget",
  "createdAt": "2026-03-07T12:00:00.000Z",
  "lastModified": "2026-03-07T12:00:00.000Z"
}
```

The schema version enables future migrations. On load, the app checks the version and runs any necessary transformations before proceeding.

## Accounts

Every financial entity is an account.

| Field          | Type    | Notes                                                                 |
|----------------|---------|-----------------------------------------------------------------------|
| `id`           | string  | UUID                                                                  |
| `name`         | string  | User-defined label (e.g. "BofA Checking", "Cash Wallet")             |
| `type`         | enum    | `cash · checking · savings · credit_card · loan · asset · crypto`     |
| `startBalance` | integer | Cents. All money stored as integers.                                  |
| `sortOrder`    | integer | Display ordering                                                      |
| `createdAt`    | string  | ISO 8601                                                              |

## Categories

Fully user-manageable. Sensible defaults prepopulated on first launch.

| Field       | Type    | Notes                                    |
|-------------|---------|------------------------------------------|
| `id`        | integer | Auto-incrementing                        |
| `name`      | string  | Display name                             |
| `group`     | string  | Logical grouping (see below)             |
| `assigned`  | integer | Cents. Budget assignment for the period. |
| `sortOrder` | integer | Display ordering within group            |

### Default Category Groups

| Group          | Categories                                                                          |
|----------------|-------------------------------------------------------------------------------------|
| Income         | Paycheck, Other Income                                                              |
| Fixed          | Housing, Bills & Utilities, Subscriptions                                           |
| Daily Living   | Groceries, Dining Out, Transportation                                               |
| Personal       | Alcohol & Smoking, Health & Beauty, Clothing, Fun & Hobbies, Allowances, Education & Business, Gifts & Giving |
| Irregular      | Housekeeping & Maintenance, Big Purchases, Travel, Taxes & Fees                     |

## Transactions

The core entity. Every financial event is a transaction.

| Field        | Type    | Notes                                                     |
|--------------|---------|-----------------------------------------------------------|
| `id`         | string  | UUID                                                      |
| `date`       | string  | ISO 8601 date                                             |
| `type`       | enum    | `income · expense · transfer`                             |
| `amount`     | integer | Cents. Always positive — type determines direction.       |
| `categoryId` | integer | FK to categories. Nullable for transfers.                 |
| `accountId`  | string  | FK to accounts. Source account for transfers.             |
| `toAccountId`| string  | FK to accounts. Destination for transfers only.           |
| `note`       | string  | Optional description                                     |
| `createdAt`  | string  | ISO 8601                                                  |

## Money Representation

All monetary values are stored as **integers in cents**. `$12.50` is `1250`. No floating point anywhere in the data layer. Display formatting is a view concern only.

## Write Safety

- Mutations write to a temp file first, then rename (atomic on most filesystems)
- Writes are debounced — the app batches rapid changes and flushes on an interval
- This keeps the UI responsive and avoids iCloud/Dropbox sync conflicts

## Schema Migrations

The `schemaVersion` field in `budget.json` drives migrations. On load, the app checks the version and runs sequential migration functions to bring the data up to the current schema. Migrations transform CSV structure in-place.
