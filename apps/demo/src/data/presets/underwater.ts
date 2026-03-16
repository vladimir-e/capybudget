import type { Account } from "@capybudget/core";
import type { DemoPreset } from "./helpers";
import { createCategories, catId, createTxnFactory, linkTransferPairs } from "./helpers";

const accounts: Account[] = [
  { id: "uw-checking", name: "Checking", type: "checking", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: "uw-credit", name: "Credit Card", type: "credit_card", archived: false, sortOrder: 1, createdAt: "2025-01-01T00:00:00Z" },
  { id: "uw-loan", name: "Student Loan", type: "loan", archived: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00Z" },
  { id: "uw-cash", name: "Cash", type: "cash", archived: false, sortOrder: 3, createdAt: "2025-01-01T00:00:00Z" },
];

const categories = createCategories();
const cat = (name: string) => catId(categories, name);
const txn = createTxnFactory("uw");

const transactions = [
  // ── Opening balances ──────────────────────────────────────────
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 50000, accountId: "uw-checking", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: -820000, accountId: "uw-credit", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: -2650000, accountId: "uw-loan", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 5000, accountId: "uw-cash", merchant: "Opening Balance" }),

  // ── January income ────────────────────────────────────────────
  txn({ datetime: "2025-01-15T09:00:00", type: "income", amount: 160000, accountId: "uw-checking", categoryId: cat("Paycheck"), merchant: "Riverside Grill" }),
  txn({ datetime: "2025-01-31T09:00:00", type: "income", amount: 160000, accountId: "uw-checking", categoryId: cat("Paycheck"), merchant: "Riverside Grill" }),

  // ── January expenses (checking) ───────────────────────────────
  txn({ datetime: "2025-01-02T10:00:00", type: "expense", amount: -95000, accountId: "uw-checking", categoryId: cat("Housing"), merchant: "Oak Park Apartments" }),
  txn({ datetime: "2025-01-05T14:00:00", type: "expense", amount: -8500, accountId: "uw-checking", categoryId: cat("Bills & Utilities"), merchant: "Duke Energy" }),
  txn({ datetime: "2025-01-06T11:00:00", type: "expense", amount: -6500, accountId: "uw-checking", categoryId: cat("Bills & Utilities"), merchant: "AT&T" }),
  txn({ datetime: "2025-01-10T17:00:00", type: "expense", amount: -18000, accountId: "uw-checking", categoryId: cat("Transportation"), merchant: "State Farm", note: "Car insurance" }),

  // ── January expenses (credit card) ────────────────────────────
  txn({ datetime: "2025-01-04T12:00:00", type: "expense", amount: -4200, accountId: "uw-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),
  txn({ datetime: "2025-01-07T18:30:00", type: "expense", amount: -850, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "McDonald's" }),
  txn({ datetime: "2025-01-09T12:00:00", type: "expense", amount: -3800, accountId: "uw-credit", categoryId: cat("Transportation"), merchant: "Speedway" }),
  txn({ datetime: "2025-01-12T19:00:00", type: "expense", amount: -1200, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "Taco Bell" }),
  txn({ datetime: "2025-01-14T11:00:00", type: "expense", amount: -5500, accountId: "uw-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),
  txn({ datetime: "2025-01-18T13:00:00", type: "expense", amount: -950, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "Subway" }),
  txn({ datetime: "2025-01-20T17:00:00", type: "expense", amount: -3500, accountId: "uw-credit", categoryId: cat("Transportation"), merchant: "Circle K" }),
  txn({ datetime: "2025-01-22T12:00:00", type: "expense", amount: -1500, accountId: "uw-credit", categoryId: cat("Health & Beauty"), merchant: "Dollar General" }),
  txn({ datetime: "2025-01-25T18:00:00", type: "expense", amount: -700, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "Wendy's" }),
  txn({ datetime: "2025-01-28T11:00:00", type: "expense", amount: -4800, accountId: "uw-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),

  // ── January transfers (minimum payments) ──────────────────────
  txn({ datetime: "2025-01-30T10:00:00", type: "transfer", amount: -20000, accountId: "uw-checking", transferPairId: "uw-cc-jan" }),
  txn({ datetime: "2025-01-30T10:00:00", type: "transfer", amount: 20000, accountId: "uw-credit", transferPairId: "uw-cc-jan" }),
  txn({ datetime: "2025-01-30T10:30:00", type: "transfer", amount: -25000, accountId: "uw-checking", transferPairId: "uw-loan-jan" }),
  txn({ datetime: "2025-01-30T10:30:00", type: "transfer", amount: 25000, accountId: "uw-loan", transferPairId: "uw-loan-jan" }),

  // ── February income ───────────────────────────────────────────
  txn({ datetime: "2025-02-14T09:00:00", type: "income", amount: 160000, accountId: "uw-checking", categoryId: cat("Paycheck"), merchant: "Riverside Grill" }),
  txn({ datetime: "2025-02-28T09:00:00", type: "income", amount: 160000, accountId: "uw-checking", categoryId: cat("Paycheck"), merchant: "Riverside Grill" }),

  // ── February expenses (checking) ──────────────────────────────
  txn({ datetime: "2025-02-01T10:00:00", type: "expense", amount: -95000, accountId: "uw-checking", categoryId: cat("Housing"), merchant: "Oak Park Apartments" }),
  txn({ datetime: "2025-02-04T14:00:00", type: "expense", amount: -9200, accountId: "uw-checking", categoryId: cat("Bills & Utilities"), merchant: "Duke Energy" }),
  txn({ datetime: "2025-02-05T11:00:00", type: "expense", amount: -6500, accountId: "uw-checking", categoryId: cat("Bills & Utilities"), merchant: "AT&T" }),

  // ── February expenses (credit card) ───────────────────────────
  txn({ datetime: "2025-02-03T12:00:00", type: "expense", amount: -5200, accountId: "uw-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),
  txn({ datetime: "2025-02-06T18:00:00", type: "expense", amount: -900, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "McDonald's" }),
  txn({ datetime: "2025-02-08T12:00:00", type: "expense", amount: -4000, accountId: "uw-credit", categoryId: cat("Transportation"), merchant: "Speedway" }),
  txn({ datetime: "2025-02-11T19:00:00", type: "expense", amount: -1100, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "Taco Bell" }),
  txn({ datetime: "2025-02-13T11:00:00", type: "expense", amount: -4800, accountId: "uw-credit", categoryId: cat("Groceries"), merchant: "Dollar General" }),
  txn({ datetime: "2025-02-16T13:00:00", type: "expense", amount: -3200, accountId: "uw-credit", categoryId: cat("Transportation"), merchant: "Circle K" }),
  txn({ datetime: "2025-02-19T18:00:00", type: "expense", amount: -800, accountId: "uw-credit", categoryId: cat("Dining Out"), merchant: "Wendy's" }),
  txn({ datetime: "2025-02-22T11:00:00", type: "expense", amount: -5000, accountId: "uw-credit", categoryId: cat("Groceries"), merchant: "Aldi" }),
  txn({ datetime: "2025-02-25T12:00:00", type: "expense", amount: -1099, accountId: "uw-credit", categoryId: cat("Subscriptions"), merchant: "Spotify" }),

  // ── February transfers (minimum payments) ─────────────────────
  txn({ datetime: "2025-02-27T10:00:00", type: "transfer", amount: -20000, accountId: "uw-checking", transferPairId: "uw-cc-feb" }),
  txn({ datetime: "2025-02-27T10:00:00", type: "transfer", amount: 20000, accountId: "uw-credit", transferPairId: "uw-cc-feb" }),
  txn({ datetime: "2025-02-27T10:30:00", type: "transfer", amount: -25000, accountId: "uw-checking", transferPairId: "uw-loan-feb" }),
  txn({ datetime: "2025-02-27T10:30:00", type: "transfer", amount: 25000, accountId: "uw-loan", transferPairId: "uw-loan-feb" }),
];

linkTransferPairs(transactions, "uw-cc-jan", "uw-loan-jan", "uw-cc-feb", "uw-loan-feb");

export const underwater: DemoPreset = {
  id: "underwater",
  name: "Underwater",
  description: "Debt-heavy, negative net worth",
  netWorth: -3100000,
  accounts,
  categories,
  transactions,
};
