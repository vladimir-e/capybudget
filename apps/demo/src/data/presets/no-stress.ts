import type { Account } from "@capybudget/core";
import type { DemoPreset } from "./helpers";
import { createCategories, catId, createTxnFactory, linkTransferPairs } from "./helpers";

const accounts: Account[] = [
  { id: "ns-checking", name: "Checking", type: "checking", archived: false, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: "ns-savings", name: "High-Yield Savings", type: "savings", archived: false, sortOrder: 1, createdAt: "2025-01-01T00:00:00Z" },
  { id: "ns-brokerage", name: "Brokerage", type: "asset", archived: false, sortOrder: 2, createdAt: "2025-01-01T00:00:00Z" },
  { id: "ns-credit", name: "Amex Platinum", type: "credit_card", archived: false, sortOrder: 3, createdAt: "2025-01-01T00:00:00Z" },
  { id: "ns-cash", name: "Cash", type: "cash", archived: false, sortOrder: 4, createdAt: "2025-01-01T00:00:00Z" },
];

const categories = createCategories();
const cat = (name: string) => catId(categories, name);
const txn = createTxnFactory("ns");

const transactions = [
  // ── Opening balances ──────────────────────────────────────────
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 1800000, accountId: "ns-checking", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 8500000, accountId: "ns-savings", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 18000000, accountId: "ns-brokerage", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: -450000, accountId: "ns-credit", merchant: "Opening Balance" }),
  txn({ datetime: "2025-01-01T00:00:00", type: "income", amount: 50000, accountId: "ns-cash", merchant: "Opening Balance" }),

  // ── January income ────────────────────────────────────────────
  txn({ datetime: "2025-01-15T09:00:00", type: "income", amount: 700000, accountId: "ns-checking", categoryId: cat("Paycheck"), merchant: "TechVenture Inc" }),
  txn({ datetime: "2025-01-31T09:00:00", type: "income", amount: 700000, accountId: "ns-checking", categoryId: cat("Paycheck"), merchant: "TechVenture Inc" }),

  // ── January expenses (checking) ───────────────────────────────
  txn({ datetime: "2025-01-02T10:00:00", type: "expense", amount: -380000, accountId: "ns-checking", categoryId: cat("Housing"), merchant: "Wells Fargo Mortgage" }),
  txn({ datetime: "2025-01-03T14:00:00", type: "expense", amount: -18000, accountId: "ns-checking", categoryId: cat("Bills & Utilities"), merchant: "PG&E" }),
  txn({ datetime: "2025-01-04T11:00:00", type: "expense", amount: -12000, accountId: "ns-checking", categoryId: cat("Bills & Utilities"), merchant: "Comcast" }),

  // ── January expenses (credit card) ────────────────────────────
  txn({ datetime: "2025-01-05T08:00:00", type: "expense", amount: -2299, accountId: "ns-credit", categoryId: cat("Subscriptions"), merchant: "Netflix Premium" }),
  txn({ datetime: "2025-01-05T08:00:00", type: "expense", amount: -1699, accountId: "ns-credit", categoryId: cat("Subscriptions"), merchant: "Spotify Family" }),
  txn({ datetime: "2025-01-05T08:30:00", type: "expense", amount: -1700, accountId: "ns-credit", categoryId: cat("Subscriptions"), merchant: "The New York Times" }),
  txn({ datetime: "2025-01-05T09:00:00", type: "expense", amount: -15000, accountId: "ns-credit", categoryId: cat("Health & Beauty"), merchant: "Equinox" }),
  txn({ datetime: "2025-01-07T12:00:00", type: "expense", amount: -18500, accountId: "ns-credit", categoryId: cat("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-01-09T19:30:00", type: "expense", amount: -28000, accountId: "ns-credit", categoryId: cat("Dining Out"), merchant: "Nobu" }),
  txn({ datetime: "2025-01-11T14:00:00", type: "expense", amount: -45000, accountId: "ns-credit", categoryId: cat("Clothing"), merchant: "Nordstrom" }),
  txn({ datetime: "2025-01-14T12:00:00", type: "expense", amount: -15200, accountId: "ns-credit", categoryId: cat("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-01-16T20:00:00", type: "expense", amount: -22000, accountId: "ns-credit", categoryId: cat("Dining Out"), merchant: "The French Laundry" }),
  txn({ datetime: "2025-01-18T10:00:00", type: "expense", amount: -8500, accountId: "ns-credit", categoryId: cat("Fun & Hobbies"), merchant: "SoulCycle" }),
  txn({ datetime: "2025-01-20T15:00:00", type: "expense", amount: -35000, accountId: "ns-credit", categoryId: cat("Clothing"), merchant: "Apple Store" }),
  txn({ datetime: "2025-01-22T11:00:00", type: "expense", amount: -12000, accountId: "ns-credit", categoryId: cat("Groceries"), merchant: "Erewhon" }),
  txn({ datetime: "2025-01-25T19:00:00", type: "expense", amount: -18500, accountId: "ns-credit", categoryId: cat("Dining Out"), merchant: "Catch" }),
  txn({ datetime: "2025-01-28T16:00:00", type: "expense", amount: -6500, accountId: "ns-credit", categoryId: cat("Transportation"), merchant: "Uber" }),

  // ── January transfers ─────────────────────────────────────────
  txn({ datetime: "2025-01-30T10:00:00", type: "transfer", amount: -200000, accountId: "ns-checking", transferPairId: "ns-cc-jan" }),
  txn({ datetime: "2025-01-30T10:00:00", type: "transfer", amount: 200000, accountId: "ns-credit", transferPairId: "ns-cc-jan" }),
  txn({ datetime: "2025-01-31T12:00:00", type: "transfer", amount: -300000, accountId: "ns-checking", transferPairId: "ns-sav-jan" }),
  txn({ datetime: "2025-01-31T12:00:00", type: "transfer", amount: 300000, accountId: "ns-savings", transferPairId: "ns-sav-jan" }),
  txn({ datetime: "2025-01-31T12:30:00", type: "transfer", amount: -200000, accountId: "ns-checking", transferPairId: "ns-inv-jan" }),
  txn({ datetime: "2025-01-31T12:30:00", type: "transfer", amount: 200000, accountId: "ns-brokerage", transferPairId: "ns-inv-jan" }),

  // ── February income ───────────────────────────────────────────
  txn({ datetime: "2025-02-14T09:00:00", type: "income", amount: 700000, accountId: "ns-checking", categoryId: cat("Paycheck"), merchant: "TechVenture Inc" }),
  txn({ datetime: "2025-02-28T09:00:00", type: "income", amount: 700000, accountId: "ns-checking", categoryId: cat("Paycheck"), merchant: "TechVenture Inc" }),

  // ── February expenses (checking) ──────────────────────────────
  txn({ datetime: "2025-02-01T10:00:00", type: "expense", amount: -380000, accountId: "ns-checking", categoryId: cat("Housing"), merchant: "Wells Fargo Mortgage" }),
  txn({ datetime: "2025-02-02T14:00:00", type: "expense", amount: -19500, accountId: "ns-checking", categoryId: cat("Bills & Utilities"), merchant: "PG&E" }),
  txn({ datetime: "2025-02-03T11:00:00", type: "expense", amount: -12000, accountId: "ns-checking", categoryId: cat("Bills & Utilities"), merchant: "Comcast" }),

  // ── February expenses (credit card) ───────────────────────────
  txn({ datetime: "2025-02-05T08:00:00", type: "expense", amount: -2299, accountId: "ns-credit", categoryId: cat("Subscriptions"), merchant: "Netflix Premium" }),
  txn({ datetime: "2025-02-05T08:00:00", type: "expense", amount: -1699, accountId: "ns-credit", categoryId: cat("Subscriptions"), merchant: "Spotify Family" }),
  txn({ datetime: "2025-02-05T08:30:00", type: "expense", amount: -1700, accountId: "ns-credit", categoryId: cat("Subscriptions"), merchant: "The New York Times" }),
  txn({ datetime: "2025-02-05T09:00:00", type: "expense", amount: -15000, accountId: "ns-credit", categoryId: cat("Health & Beauty"), merchant: "Equinox" }),
  txn({ datetime: "2025-02-06T17:00:00", type: "expense", amount: -16800, accountId: "ns-credit", categoryId: cat("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-02-08T20:00:00", type: "expense", amount: -32000, accountId: "ns-credit", categoryId: cat("Dining Out"), merchant: "Le Bernardin" }),
  txn({ datetime: "2025-02-10T14:00:00", type: "expense", amount: -120000, accountId: "ns-credit", categoryId: cat("Travel"), merchant: "Delta Airlines", note: "Tokyo flights" }),
  txn({ datetime: "2025-02-12T11:00:00", type: "expense", amount: -14500, accountId: "ns-credit", categoryId: cat("Groceries"), merchant: "Erewhon" }),
  txn({ datetime: "2025-02-14T19:00:00", type: "expense", amount: -42000, accountId: "ns-credit", categoryId: cat("Dining Out"), merchant: "Per Se", note: "Valentine's dinner" }),
  txn({ datetime: "2025-02-16T15:00:00", type: "expense", amount: -65000, accountId: "ns-credit", categoryId: cat("Clothing"), merchant: "Nordstrom" }),
  txn({ datetime: "2025-02-18T10:00:00", type: "expense", amount: -8500, accountId: "ns-credit", categoryId: cat("Fun & Hobbies"), merchant: "SoulCycle" }),
  txn({ datetime: "2025-02-20T17:00:00", type: "expense", amount: -13200, accountId: "ns-credit", categoryId: cat("Groceries"), merchant: "Whole Foods" }),
  txn({ datetime: "2025-02-22T12:00:00", type: "expense", amount: -9500, accountId: "ns-credit", categoryId: cat("Transportation"), merchant: "Uber" }),
  txn({ datetime: "2025-02-25T19:00:00", type: "expense", amount: -25000, accountId: "ns-credit", categoryId: cat("Dining Out"), merchant: "Masa" }),

  // ── February transfers ────────────────────────────────────────
  txn({ datetime: "2025-02-27T10:00:00", type: "transfer", amount: -350000, accountId: "ns-checking", transferPairId: "ns-cc-feb" }),
  txn({ datetime: "2025-02-27T10:00:00", type: "transfer", amount: 350000, accountId: "ns-credit", transferPairId: "ns-cc-feb" }),
  txn({ datetime: "2025-02-28T12:00:00", type: "transfer", amount: -300000, accountId: "ns-checking", transferPairId: "ns-sav-feb" }),
  txn({ datetime: "2025-02-28T12:00:00", type: "transfer", amount: 300000, accountId: "ns-savings", transferPairId: "ns-sav-feb" }),
  txn({ datetime: "2025-02-28T12:30:00", type: "transfer", amount: -200000, accountId: "ns-checking", transferPairId: "ns-inv-feb" }),
  txn({ datetime: "2025-02-28T12:30:00", type: "transfer", amount: 200000, accountId: "ns-brokerage", transferPairId: "ns-inv-feb" }),
];

linkTransferPairs(transactions, "ns-cc-jan", "ns-sav-jan", "ns-inv-jan", "ns-cc-feb", "ns-sav-feb", "ns-inv-feb");

export const noStress: DemoPreset = {
  id: "no-stress",
  name: "No Stress",
  description: "High earner, diversified portfolio",
  netWorth: 27900000,
  accounts,
  categories,
  transactions,
};
