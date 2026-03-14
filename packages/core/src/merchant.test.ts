import { describe, expect, it } from "vitest";
import {
  findCategoryForMerchant,
  getUniqueMerchants,
  matchMerchants,
} from "./merchant";
import type { Transaction } from "./types";

function txn(
  overrides: Partial<Transaction> & Pick<Transaction, "merchant">,
): Transaction {
  return {
    id: crypto.randomUUID(),
    datetime: "2024-01-15T10:00:00.000",
    type: "expense",
    amount: -1000,
    categoryId: "",
    accountId: "acc-1",
    transferPairId: "",
    note: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getUniqueMerchants
// ---------------------------------------------------------------------------

describe("getUniqueMerchants", () => {
  it("returns unique merchants sorted alphabetically", () => {
    const txns = [
      txn({ merchant: "Subway" }),
      txn({ merchant: "Amazon" }),
      txn({ merchant: "Subway" }),
      txn({ merchant: "Nike" }),
    ];
    expect(getUniqueMerchants(txns)).toEqual(["Amazon", "Nike", "Subway"]);
  });

  it("skips empty merchants", () => {
    const txns = [txn({ merchant: "" }), txn({ merchant: "Amazon" })];
    expect(getUniqueMerchants(txns)).toEqual(["Amazon"]);
  });

  it("deduplicates case-insensitively, keeping the last casing", () => {
    const txns = [
      txn({ merchant: "subway" }),
      txn({ merchant: "SUBWAY" }),
      txn({ merchant: "Subway" }),
    ];
    expect(getUniqueMerchants(txns)).toEqual(["Subway"]);
  });

  it("returns empty array for no transactions", () => {
    expect(getUniqueMerchants([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchMerchants
// ---------------------------------------------------------------------------

describe("matchMerchants", () => {
  const merchants = [
    "Amazon",
    "Amazon Prime",
    "NYC MTA",
    "Pubsubway",
    "Subway",
    "Whole Foods",
  ];

  it("returns all merchants for empty query", () => {
    expect(matchMerchants(merchants, "")).toEqual(merchants);
  });

  it("prioritizes word-start matches over substring matches", () => {
    const result = matchMerchants(merchants, "sub");
    expect(result).toEqual(["Subway", "Pubsubway"]);
  });

  it("matches case-insensitively", () => {
    expect(matchMerchants(merchants, "AMAZON")).toEqual([
      "Amazon",
      "Amazon Prime",
    ]);
  });

  it("matches words after the first word", () => {
    const result = matchMerchants(merchants, "food");
    expect(result).toEqual(["Whole Foods"]);
  });

  it("returns empty for no matches", () => {
    expect(matchMerchants(merchants, "xyz")).toEqual([]);
  });

  it("matches MTA as word-start in NYC MTA", () => {
    expect(matchMerchants(merchants, "mta")).toEqual(["NYC MTA"]);
  });
});

// ---------------------------------------------------------------------------
// findCategoryForMerchant
// ---------------------------------------------------------------------------

describe("findCategoryForMerchant", () => {
  it("returns categoryId from the most recent matching transaction", () => {
    const txns = [
      txn({ merchant: "Subway", categoryId: "cat-old", datetime: "2024-01-10T10:00:00.000" }),
      txn({ merchant: "Subway", categoryId: "cat-new", datetime: "2024-01-15T10:00:00.000" }),
    ];
    expect(findCategoryForMerchant(txns, "Subway")).toBe("cat-new");
  });

  it("picks most recent by datetime regardless of array order", () => {
    const txns = [
      txn({ merchant: "Subway", categoryId: "cat-new", datetime: "2024-01-15T10:00:00.000" }),
      txn({ merchant: "Subway", categoryId: "cat-old", datetime: "2024-01-10T10:00:00.000" }),
    ];
    expect(findCategoryForMerchant(txns, "Subway")).toBe("cat-new");
  });

  it("skips transactions with empty categoryId", () => {
    const txns = [
      txn({ merchant: "Subway", categoryId: "cat-1" }),
      txn({ merchant: "Subway", categoryId: "" }),
    ];
    expect(findCategoryForMerchant(txns, "Subway")).toBe("cat-1");
  });

  it("matches case-insensitively", () => {
    const txns = [txn({ merchant: "subway", categoryId: "cat-1" })];
    expect(findCategoryForMerchant(txns, "Subway")).toBe("cat-1");
  });

  it("returns empty string for empty merchant", () => {
    const txns = [txn({ merchant: "Subway", categoryId: "cat-1" })];
    expect(findCategoryForMerchant(txns, "")).toBe("");
  });

  it("returns empty string when no matching merchant", () => {
    const txns = [txn({ merchant: "Subway", categoryId: "cat-1" })];
    expect(findCategoryForMerchant(txns, "Nike")).toBe("");
  });

  it("returns empty string for empty transactions array", () => {
    expect(findCategoryForMerchant([], "Subway")).toBe("");
  });
});
