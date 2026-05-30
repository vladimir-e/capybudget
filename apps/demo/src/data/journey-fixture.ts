import type { MemoryRepositoryData } from "@capybudget/persistence";
import { account, createCategories } from "./profiles/helpers";

/** A tiny, static dataset for the app-shell journey tests: enough accounts and
 *  rows to assert the sidebar lists accounts, the table renders transactions,
 *  and account navigation works — with no dependency on the generator. Generator
 *  correctness is covered separately in `generator.test.ts`. */
const categories = createCategories();
const cat = (name: string) => categories.find((c) => c.name === name)?.id ?? "";

const CHECKING = "jf-checking";
const SAVINGS = "jf-savings";

export const JOURNEY_FIXTURE: Required<MemoryRepositoryData> = {
  accounts: [
    account(CHECKING, "Checking", "checking", 0),
    account(SAVINGS, "Savings", "savings", 1),
  ],
  categories,
  transactions: [
    { id: "jf-1", datetime: "2026-01-01T00:00:00", type: "income", amount: 500_000, categoryId: "", accountId: CHECKING, transferPairId: "", merchant: "Opening Balance", note: "", createdAt: "2026-01-01T00:00:00Z" },
    { id: "jf-2", datetime: "2026-01-01T00:00:01", type: "income", amount: 1_000_000, categoryId: "", accountId: SAVINGS, transferPairId: "", merchant: "Opening Balance", note: "", createdAt: "2026-01-01T00:00:01Z" },
    { id: "jf-3", datetime: "2026-01-15T09:00:00", type: "income", amount: 400_000, categoryId: cat("Paycheck"), accountId: CHECKING, transferPairId: "", merchant: "Acme Corp", note: "", createdAt: "2026-01-15T09:00:00Z" },
    { id: "jf-4", datetime: "2026-01-02T10:00:00", type: "expense", amount: -150_000, categoryId: cat("Housing"), accountId: CHECKING, transferPairId: "", merchant: "Landlord", note: "", createdAt: "2026-01-02T10:00:00Z" },
    { id: "jf-5", datetime: "2026-01-03T11:00:00", type: "expense", amount: -6_500, categoryId: cat("Groceries"), accountId: CHECKING, transferPairId: "", merchant: "Trader Joe's", note: "", createdAt: "2026-01-03T11:00:00Z" },
    { id: "jf-6", datetime: "2026-01-05T18:30:00", type: "expense", amount: -3_200, categoryId: cat("Dining Out"), accountId: CHECKING, transferPairId: "", merchant: "Chipotle", note: "", createdAt: "2026-01-05T18:30:00Z" },
    { id: "jf-7", datetime: "2026-01-07T08:00:00", type: "expense", amount: -1_299, categoryId: cat("Subscriptions"), accountId: CHECKING, transferPairId: "", merchant: "Spotify", note: "", createdAt: "2026-01-07T08:00:00Z" },
    { id: "jf-8", datetime: "2026-01-09T14:00:00", type: "expense", amount: -4_800, categoryId: cat("Transportation"), accountId: CHECKING, transferPairId: "", merchant: "Shell", note: "", createdAt: "2026-01-09T14:00:00Z" },
    { id: "jf-9", datetime: "2026-01-12T16:00:00", type: "expense", amount: -2_100, categoryId: cat("Groceries"), accountId: CHECKING, transferPairId: "", merchant: "Safeway", note: "", createdAt: "2026-01-12T16:00:00Z" },
    { id: "jf-10", datetime: "2026-01-20T12:00:00", type: "transfer", amount: -100_000, categoryId: "", accountId: CHECKING, transferPairId: "jf-11", merchant: "", note: "Savings sweep", createdAt: "2026-01-20T12:00:00Z" },
    { id: "jf-11", datetime: "2026-01-20T12:00:00", type: "transfer", amount: 100_000, categoryId: "", accountId: SAVINGS, transferPairId: "jf-10", merchant: "", note: "Savings sweep", createdAt: "2026-01-20T12:00:00Z" },
    { id: "jf-12", datetime: "2026-01-25T19:00:00", type: "expense", amount: -5_500, categoryId: cat("Dining Out"), accountId: CHECKING, transferPairId: "", merchant: "Local Bistro", note: "", createdAt: "2026-01-25T19:00:00Z" },
  ],
};
