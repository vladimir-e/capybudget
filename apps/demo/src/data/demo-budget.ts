import type { Account, Category, Transaction } from "@capybudget/core";
import { DEFAULT_CATEGORIES } from "@capybudget/core";

// ── Accounts ────────────────────────────────────────────────────

export const DEMO_ACCOUNTS: Account[] = [
  { id: "acct-checking", name: "Main Checking", type: "checking", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: "acct-savings", name: "Savings", type: "savings", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: "acct-credit", name: "Visa Card", type: "credit_card", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: "acct-cash", name: "Cash", type: "cash", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
];

// ── Categories ──────────────────────────────────────────────────

export const DEMO_CATEGORIES: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({
  ...c,
  id: `cat-${i}`,
}));

// Helper to find category ID by name
function catId(name: string): string {
  return DEMO_CATEGORIES.find((c) => c.name === name)?.id ?? "";
}

// ── Transactions ────────────────────────────────────────────────

let txnCounter = 0;
function txn(
  overrides: Partial<Transaction> & Pick<Transaction, "datetime" | "type" | "amount" | "accountId">,
): Transaction {
  txnCounter++;
  return {
    id: `txn-${txnCounter}`,
    datetime: overrides.datetime,
    type: overrides.type,
    amount: overrides.amount,
    categoryId: overrides.categoryId ?? "",
    accountId: overrides.accountId,
    transferPairId: overrides.transferPairId ?? "",
    merchant: overrides.merchant ?? "",
    note: overrides.note ?? "",
    createdAt: `2025-01-01T00:00:${String(txnCounter).padStart(2, "0")}Z`,
  };
}

export const DEMO_TRANSACTIONS: Transaction[] = [
  // Opening balances
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 850000, accountId: "acct-checking", note: "Opening balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 1200000, accountId: "acct-savings", note: "Opening balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "expense", amount: 245000, accountId: "acct-credit", note: "Opening balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 15000, accountId: "acct-cash", note: "Opening balance" }),

  // January income
  txn({ datetime: "2025-01-15T09:00:00", type: "income", amount: 520000, accountId: "acct-checking", categoryId: catId("Paycheck"), merchant: "Acme Corp" }),
  txn({ datetime: "2025-01-31T09:00:00", type: "income", amount: 520000, accountId: "acct-checking", categoryId: catId("Paycheck"), merchant: "Acme Corp" }),

  // January expenses
  txn({ datetime: "2025-01-02T10:30:00", type: "expense", amount: 195000, accountId: "acct-checking", categoryId: catId("Housing"), merchant: "Pine Street Apartments" }),
  txn({ datetime: "2025-01-03T14:00:00", type: "expense", amount: 12500, accountId: "acct-checking", categoryId: catId("Bills & Utilities"), merchant: "City Water" }),
  txn({ datetime: "2025-01-04T11:00:00", type: "expense", amount: 8500, accountId: "acct-checking", categoryId: catId("Bills & Utilities"), merchant: "Verizon" }),
  txn({ datetime: "2025-01-05T08:00:00", type: "expense", amount: 1599, accountId: "acct-credit", categoryId: catId("Subscriptions"), merchant: "Netflix" }),
  txn({ datetime: "2025-01-05T08:00:00", type: "expense", amount: 1099, accountId: "acct-credit", categoryId: catId("Subscriptions"), merchant: "Spotify" }),
  txn({ datetime: "2025-01-06T17:30:00", type: "expense", amount: 9450, accountId: "acct-credit", categoryId: catId("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-01-08T12:15:00", type: "expense", amount: 4200, accountId: "acct-credit", categoryId: catId("Dining Out"), merchant: "Chipotle" }),
  txn({ datetime: "2025-01-10T19:00:00", type: "expense", amount: 8700, accountId: "acct-credit", categoryId: catId("Dining Out"), merchant: "Olive Garden" }),
  txn({ datetime: "2025-01-12T10:00:00", type: "expense", amount: 4500, accountId: "acct-checking", categoryId: catId("Transportation"), merchant: "Shell Gas" }),
  txn({ datetime: "2025-01-14T16:00:00", type: "expense", amount: 7800, accountId: "acct-credit", categoryId: catId("Groceries"), merchant: "Trader Joe's" }),
  txn({ datetime: "2025-01-18T14:30:00", type: "expense", amount: 3500, accountId: "acct-cash", categoryId: catId("Fun & Hobbies"), merchant: "Board Game Cafe" }),
  txn({ datetime: "2025-01-20T09:00:00", type: "expense", amount: 5500, accountId: "acct-credit", categoryId: catId("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-01-22T11:00:00", type: "expense", amount: 2500, accountId: "acct-credit", categoryId: catId("Health & Beauty"), merchant: "CVS Pharmacy" }),
  txn({ datetime: "2025-01-25T13:00:00", type: "expense", amount: 12000, accountId: "acct-credit", categoryId: catId("Clothing"), merchant: "Uniqlo" }),
  txn({ datetime: "2025-01-28T18:00:00", type: "expense", amount: 6500, accountId: "acct-credit", categoryId: catId("Dining Out"), merchant: "Sushi Hana" }),

  // January transfer: checking → savings
  txn({ datetime: "2025-01-31T12:00:00", type: "transfer", amount: 100000, accountId: "acct-checking", transferPairId: "txn-pair-jan" }),
  txn({ datetime: "2025-01-31T12:00:00", type: "transfer", amount: 100000, accountId: "acct-savings", transferPairId: "txn-pair-jan" }),

  // February income
  txn({ datetime: "2025-02-14T09:00:00", type: "income", amount: 520000, accountId: "acct-checking", categoryId: catId("Paycheck"), merchant: "Acme Corp" }),
  txn({ datetime: "2025-02-28T09:00:00", type: "income", amount: 520000, accountId: "acct-checking", categoryId: catId("Paycheck"), merchant: "Acme Corp" }),
  txn({ datetime: "2025-02-20T15:00:00", type: "income", amount: 25000, accountId: "acct-checking", categoryId: catId("Other Income"), merchant: "Freelance Project" }),

  // February expenses
  txn({ datetime: "2025-02-01T10:30:00", type: "expense", amount: 195000, accountId: "acct-checking", categoryId: catId("Housing"), merchant: "Pine Street Apartments" }),
  txn({ datetime: "2025-02-02T14:00:00", type: "expense", amount: 13000, accountId: "acct-checking", categoryId: catId("Bills & Utilities"), merchant: "City Water" }),
  txn({ datetime: "2025-02-03T11:00:00", type: "expense", amount: 8500, accountId: "acct-checking", categoryId: catId("Bills & Utilities"), merchant: "Verizon" }),
  txn({ datetime: "2025-02-05T08:00:00", type: "expense", amount: 1599, accountId: "acct-credit", categoryId: catId("Subscriptions"), merchant: "Netflix" }),
  txn({ datetime: "2025-02-05T08:00:00", type: "expense", amount: 1099, accountId: "acct-credit", categoryId: catId("Subscriptions"), merchant: "Spotify" }),
  txn({ datetime: "2025-02-06T17:00:00", type: "expense", amount: 11200, accountId: "acct-credit", categoryId: catId("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-02-08T12:30:00", type: "expense", amount: 3800, accountId: "acct-credit", categoryId: catId("Dining Out"), merchant: "Panera Bread" }),
  txn({ datetime: "2025-02-10T19:30:00", type: "expense", amount: 15000, accountId: "acct-credit", categoryId: catId("Dining Out"), merchant: "The Capital Grille", note: "Valentine's dinner" }),
  txn({ datetime: "2025-02-12T10:00:00", type: "expense", amount: 5200, accountId: "acct-checking", categoryId: catId("Transportation"), merchant: "Shell Gas" }),
  txn({ datetime: "2025-02-14T16:00:00", type: "expense", amount: 8500, accountId: "acct-credit", categoryId: catId("Groceries"), merchant: "Trader Joe's" }),
  txn({ datetime: "2025-02-15T14:00:00", type: "expense", amount: 4500, accountId: "acct-credit", categoryId: catId("Gifts & Giving"), merchant: "Flower Shop", note: "Valentine's Day flowers" }),
  txn({ datetime: "2025-02-18T09:30:00", type: "expense", amount: 2000, accountId: "acct-cash", categoryId: catId("Fun & Hobbies"), merchant: "Movie Theater" }),
  txn({ datetime: "2025-02-20T17:00:00", type: "expense", amount: 6800, accountId: "acct-credit", categoryId: catId("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-02-22T10:00:00", type: "expense", amount: 3200, accountId: "acct-credit", categoryId: catId("Health & Beauty"), merchant: "CVS Pharmacy" }),
  txn({ datetime: "2025-02-24T12:00:00", type: "expense", amount: 4800, accountId: "acct-credit", categoryId: catId("Dining Out"), merchant: "Chipotle" }),
  txn({ datetime: "2025-02-26T15:00:00", type: "expense", amount: 35000, accountId: "acct-credit", categoryId: catId("Big Purchases"), merchant: "Best Buy", note: "New monitor" }),

  // February transfer: checking → savings
  txn({ datetime: "2025-02-28T12:00:00", type: "transfer", amount: 100000, accountId: "acct-checking", transferPairId: "txn-pair-feb" }),
  txn({ datetime: "2025-02-28T12:00:00", type: "transfer", amount: 100000, accountId: "acct-savings", transferPairId: "txn-pair-feb" }),

  // Credit card payment
  txn({ datetime: "2025-02-28T14:00:00", type: "transfer", amount: 150000, accountId: "acct-checking", transferPairId: "txn-pair-cc" }),
  txn({ datetime: "2025-02-28T14:00:00", type: "transfer", amount: 150000, accountId: "acct-credit", transferPairId: "txn-pair-cc" }),
];

// Fix transfer pair IDs to be cross-referencing (each leg stores the OTHER leg's ID)
function linkTransferPair(txns: Transaction[], pairId: string) {
  const pair = txns.filter((t) => t.transferPairId === pairId);
  if (pair.length === 2) {
    pair[0].transferPairId = pair[1].id;
    pair[1].transferPairId = pair[0].id;
  }
}

linkTransferPair(DEMO_TRANSACTIONS, "txn-pair-jan");
linkTransferPair(DEMO_TRANSACTIONS, "txn-pair-feb");
linkTransferPair(DEMO_TRANSACTIONS, "txn-pair-cc");
