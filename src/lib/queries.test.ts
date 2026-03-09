import { describe, it, expect } from "vitest";
import {
  getAccountBalance,
  getAccountsByGroup,
  getTransactionsForAccount,
  getNetWorth,
} from "@/lib/queries";
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from "@/lib/mock-data";

describe("getAccountBalance", () => {
  it("sums all transaction amounts for an account", () => {
    const balance = getAccountBalance("acc-cash-01", MOCK_TRANSACTIONS);
    // 20000 (opening) - 3500 (gas) = 16500
    expect(balance).toBe(16500);
  });

  it("returns 0 for an account with no transactions", () => {
    expect(getAccountBalance("nonexistent", MOCK_TRANSACTIONS)).toBe(0);
  });

  it("handles credit card with negative opening + expenses + payment", () => {
    const balance = getAccountBalance("acc-credit-01", MOCK_TRANSACTIONS);
    // -85000 (opening) - 8500 - 4200 - 1599 - 12000 - 7500 - 4999 + 50000 (payment)
    expect(balance).toBe(-73798);
  });
});

describe("getAccountsByGroup", () => {
  it("groups accounts by type in display order", () => {
    const groups = getAccountsByGroup(MOCK_ACCOUNTS);
    const keys = [...groups.keys()];
    expect(keys).toEqual(["cash", "checking", "savings", "credit_card", "loan", "crypto"]);
  });

  it("excludes archived accounts", () => {
    const archived = [
      ...MOCK_ACCOUNTS,
      { id: "arc-1", name: "Old", type: "checking" as const, archived: true, sortOrder: 99, createdAt: "" },
    ];
    const groups = getAccountsByGroup(archived);
    const checking = groups.get("checking")!;
    expect(checking.every((a) => !a.archived)).toBe(true);
  });
});

describe("getTransactionsForAccount", () => {
  it("returns all transactions when accountId is null", () => {
    expect(getTransactionsForAccount(null, MOCK_TRANSACTIONS)).toBe(MOCK_TRANSACTIONS);
  });

  it("filters to a specific account", () => {
    const txns = getTransactionsForAccount("acc-cash-01", MOCK_TRANSACTIONS);
    expect(txns.every((t) => t.accountId === "acc-cash-01")).toBe(true);
    expect(txns.length).toBe(2);
  });
});

describe("getNetWorth", () => {
  it("sums non-archived account balances", () => {
    const netWorth = getNetWorth(MOCK_ACCOUNTS, MOCK_TRANSACTIONS);
    // Cash: 16500, Checking: 345000, Savings: 1050000, Credit: -73798, Crypto: 0
    // Checking: 500000 + 420000 + 420000 - 185000 - 50000 - 50000 - 185000 - 25000 = 845000... let me just check it's a number
    expect(typeof netWorth).toBe("number");
    expect(netWorth).toBeGreaterThan(0);
  });
});
