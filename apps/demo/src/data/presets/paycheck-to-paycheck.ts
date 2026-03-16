import type { Account } from "@capybudget/core";
import type { DemoPreset } from "./helpers";
import { createCategories, catId, createTxnFactory, linkTransferPairs } from "./helpers";

const accounts: Account[] = [
  { id: "p2p-checking", name: "Checking", type: "checking", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: "p2p-savings", name: "Savings", type: "savings", archived: false, sortOrder: 1, createdAt: "2025-01-01T00:00:00Z" },
  { id: "p2p-credit", name: "Visa Card", type: "credit_card", archived: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00Z" },
];

const categories = createCategories();
const cat = (name: string) => catId(categories, name);
const txn = createTxnFactory("p2p");

const transactions = [
  // ── Opening balances ──────────────────────────────────────────
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 120000, accountId: "p2p-checking", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 40000, accountId: "p2p-savings", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: -60000, accountId: "p2p-credit", merchant: "Opening Balance" }),

  // ── January income ────────────────────────────────────────────
  txn({ datetime: "2025-01-15T09:00:00", type: "income", amount: 210000, accountId: "p2p-checking", categoryId: cat("Paycheck"), merchant: "Midwest Insurance Co" }),
  txn({ datetime: "2025-01-31T09:00:00", type: "income", amount: 210000, accountId: "p2p-checking", categoryId: cat("Paycheck"), merchant: "Midwest Insurance Co" }),

  // ── January expenses (checking) ───────────────────────────────
  txn({ datetime: "2025-01-02T10:00:00", type: "expense", amount: -135000, accountId: "p2p-checking", categoryId: cat("Housing"), merchant: "Lakewood Apartments" }),
  txn({ datetime: "2025-01-03T14:00:00", type: "expense", amount: -12500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "ComEd" }),
  txn({ datetime: "2025-01-04T11:00:00", type: "expense", amount: -7500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "Xfinity" }),
  txn({ datetime: "2025-01-05T09:00:00", type: "expense", amount: -4500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "City Water" }),
  txn({ datetime: "2025-01-06T10:00:00", type: "expense", amount: -8500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "T-Mobile" }),
  txn({ datetime: "2025-01-07T09:00:00", type: "expense", amount: -18000, accountId: "p2p-checking", categoryId: cat("Transportation"), merchant: "State Farm", note: "Car insurance" }),
  txn({ datetime: "2025-01-08T17:00:00", type: "expense", amount: -4500, accountId: "p2p-checking", categoryId: cat("Transportation"), merchant: "Shell Gas" }),
  txn({ datetime: "2025-01-12T11:00:00", type: "expense", amount: -35000, accountId: "p2p-checking", categoryId: cat("Groceries"), merchant: "Kroger" }),
  txn({ datetime: "2025-01-20T17:00:00", type: "expense", amount: -5000, accountId: "p2p-checking", categoryId: cat("Transportation"), merchant: "BP" }),
  txn({ datetime: "2025-01-22T10:00:00", type: "expense", amount: -28000, accountId: "p2p-checking", categoryId: cat("Groceries"), merchant: "Aldi" }),

  // ── January expenses (credit card) ────────────────────────────
  txn({ datetime: "2025-01-05T08:00:00", type: "expense", amount: -1599, accountId: "p2p-credit", categoryId: cat("Subscriptions"), merchant: "Netflix" }),
  txn({ datetime: "2025-01-05T08:00:00", type: "expense", amount: -1099, accountId: "p2p-credit", categoryId: cat("Subscriptions"), merchant: "Spotify" }),
  txn({ datetime: "2025-01-05T09:00:00", type: "expense", amount: -4500, accountId: "p2p-credit", categoryId: cat("Health & Beauty"), merchant: "Planet Fitness" }),
  txn({ datetime: "2025-01-06T17:00:00", type: "expense", amount: -7800, accountId: "p2p-credit", categoryId: cat("Groceries"), merchant: "Kroger" }),
  txn({ datetime: "2025-01-10T12:00:00", type: "expense", amount: -3500, accountId: "p2p-credit", categoryId: cat("Dining Out"), merchant: "Chipotle" }),
  txn({ datetime: "2025-01-14T16:00:00", type: "expense", amount: -6500, accountId: "p2p-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),
  txn({ datetime: "2025-01-18T19:00:00", type: "expense", amount: -4200, accountId: "p2p-credit", categoryId: cat("Dining Out"), merchant: "Applebee's" }),
  txn({ datetime: "2025-01-22T11:00:00", type: "expense", amount: -5800, accountId: "p2p-credit", categoryId: cat("Groceries"), merchant: "Kroger" }),
  txn({ datetime: "2025-01-26T14:00:00", type: "expense", amount: -2500, accountId: "p2p-credit", categoryId: cat("Health & Beauty"), merchant: "CVS Pharmacy" }),

  // ── January transfer (CC payment) ─────────────────────────────
  txn({ datetime: "2025-01-30T10:00:00", type: "transfer", amount: -35000, accountId: "p2p-checking", transferPairId: "p2p-cc-jan" }),
  txn({ datetime: "2025-01-30T10:00:00", type: "transfer", amount: 35000, accountId: "p2p-credit", transferPairId: "p2p-cc-jan" }),

  // ── February income ───────────────────────────────────────────
  txn({ datetime: "2025-02-14T09:00:00", type: "income", amount: 210000, accountId: "p2p-checking", categoryId: cat("Paycheck"), merchant: "Midwest Insurance Co" }),
  txn({ datetime: "2025-02-28T09:00:00", type: "income", amount: 210000, accountId: "p2p-checking", categoryId: cat("Paycheck"), merchant: "Midwest Insurance Co" }),

  // ── February expenses (checking) ──────────────────────────────
  txn({ datetime: "2025-02-01T10:00:00", type: "expense", amount: -135000, accountId: "p2p-checking", categoryId: cat("Housing"), merchant: "Lakewood Apartments" }),
  txn({ datetime: "2025-02-03T14:00:00", type: "expense", amount: -13500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "ComEd" }),
  txn({ datetime: "2025-02-04T11:00:00", type: "expense", amount: -7500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "Xfinity" }),
  txn({ datetime: "2025-02-05T09:00:00", type: "expense", amount: -4500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "City Water" }),
  txn({ datetime: "2025-02-06T10:00:00", type: "expense", amount: -8500, accountId: "p2p-checking", categoryId: cat("Bills & Utilities"), merchant: "T-Mobile" }),
  txn({ datetime: "2025-02-07T09:00:00", type: "expense", amount: -18000, accountId: "p2p-checking", categoryId: cat("Transportation"), merchant: "State Farm", note: "Car insurance" }),
  txn({ datetime: "2025-02-12T17:00:00", type: "expense", amount: -4800, accountId: "p2p-checking", categoryId: cat("Transportation"), merchant: "Shell Gas" }),
  txn({ datetime: "2025-02-14T11:00:00", type: "expense", amount: -38000, accountId: "p2p-checking", categoryId: cat("Groceries"), merchant: "Kroger" }),
  txn({ datetime: "2025-02-22T17:00:00", type: "expense", amount: -4500, accountId: "p2p-checking", categoryId: cat("Transportation"), merchant: "BP" }),
  txn({ datetime: "2025-02-24T10:00:00", type: "expense", amount: -30000, accountId: "p2p-checking", categoryId: cat("Groceries"), merchant: "Aldi" }),

  // ── February expenses (credit card) ───────────────────────────
  txn({ datetime: "2025-02-05T08:00:00", type: "expense", amount: -1599, accountId: "p2p-credit", categoryId: cat("Subscriptions"), merchant: "Netflix" }),
  txn({ datetime: "2025-02-05T08:00:00", type: "expense", amount: -1099, accountId: "p2p-credit", categoryId: cat("Subscriptions"), merchant: "Spotify" }),
  txn({ datetime: "2025-02-05T09:00:00", type: "expense", amount: -4500, accountId: "p2p-credit", categoryId: cat("Health & Beauty"), merchant: "Planet Fitness" }),
  txn({ datetime: "2025-02-07T17:00:00", type: "expense", amount: -8200, accountId: "p2p-credit", categoryId: cat("Groceries"), merchant: "Kroger" }),
  txn({ datetime: "2025-02-10T12:30:00", type: "expense", amount: -2800, accountId: "p2p-credit", categoryId: cat("Dining Out"), merchant: "Panera Bread" }),
  txn({ datetime: "2025-02-14T19:00:00", type: "expense", amount: -6500, accountId: "p2p-credit", categoryId: cat("Dining Out"), merchant: "Olive Garden", note: "Valentine's dinner" }),
  txn({ datetime: "2025-02-16T11:00:00", type: "expense", amount: -7200, accountId: "p2p-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),
  txn({ datetime: "2025-02-20T16:00:00", type: "expense", amount: -6000, accountId: "p2p-credit", categoryId: cat("Groceries"), merchant: "Kroger" }),
  txn({ datetime: "2025-02-24T10:00:00", type: "expense", amount: -3200, accountId: "p2p-credit", categoryId: cat("Health & Beauty"), merchant: "Walgreens" }),

  // ── February transfer (CC payment) ────────────────────────────
  txn({ datetime: "2025-02-27T10:00:00", type: "transfer", amount: -40000, accountId: "p2p-checking", transferPairId: "p2p-cc-feb" }),
  txn({ datetime: "2025-02-27T10:00:00", type: "transfer", amount: 40000, accountId: "p2p-credit", transferPairId: "p2p-cc-feb" }),

  // ── February transfer (savings) ───────────────────────────────
  txn({ datetime: "2025-02-28T12:00:00", type: "transfer", amount: -5000, accountId: "p2p-checking", transferPairId: "p2p-sav-feb" }),
  txn({ datetime: "2025-02-28T12:00:00", type: "transfer", amount: 5000, accountId: "p2p-savings", transferPairId: "p2p-sav-feb" }),
];

linkTransferPairs(transactions, "p2p-cc-jan", "p2p-cc-feb", "p2p-sav-feb");

export const paycheckToPaycheck: DemoPreset = {
  id: "paycheck-to-paycheck",
  name: "Paycheck to Paycheck",
  description: "Barely breaking even, thin savings buffer",
  netWorth: 100000,
  accounts,
  categories,
  transactions,
};
