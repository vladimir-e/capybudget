import { describe, it, expect } from "vitest";
import {
  bulkDeleteTransactions,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
} from "@/services/bulk-transactions";
import type { Transaction } from "@/lib/types";

const base: Omit<Transaction, "id" | "amount" | "type" | "categoryId" | "accountId"> = {
  datetime: "2025-01-15T10:00:00",
  transferPairId: "",
  merchant: "Store",
  note: "",
  createdAt: "2025-01-15T10:00:00Z",
};

const txns: Transaction[] = [
  { ...base, id: "t1", type: "expense", amount: -500, categoryId: "c1", accountId: "a1" },
  { ...base, id: "t2", type: "income", amount: 1000, categoryId: "c2", accountId: "a1" },
  { ...base, id: "t3", type: "expense", amount: -200, categoryId: "c1", accountId: "a2" },
  // Transfer pair
  { ...base, id: "t4", type: "transfer", amount: -300, categoryId: "", accountId: "a1", transferPairId: "t5", merchant: "" },
  { ...base, id: "t5", type: "transfer", amount: 300, categoryId: "", accountId: "a2", transferPairId: "t4", merchant: "" },
];

describe("bulkDeleteTransactions", () => {
  it("deletes selected transactions", () => {
    const result = bulkDeleteTransactions(new Set(["t1", "t3"]), txns);
    expect(result.map((t) => t.id)).toEqual(["t2", "t4", "t5"]);
  });

  it("deletes both legs of a transfer when one leg is selected", () => {
    const result = bulkDeleteTransactions(new Set(["t4"]), txns);
    expect(result.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });
});

describe("bulkAssignCategory", () => {
  it("assigns category to selected non-transfer transactions", () => {
    const result = bulkAssignCategory(new Set(["t1", "t2", "t4"]), "c99", txns);
    expect(result.find((t) => t.id === "t1")!.categoryId).toBe("c99");
    expect(result.find((t) => t.id === "t2")!.categoryId).toBe("c99");
    // Transfer should be unchanged
    expect(result.find((t) => t.id === "t4")!.categoryId).toBe("");
  });
});

describe("bulkMoveAccount", () => {
  it("moves selected non-transfer transactions to a new account", () => {
    const result = bulkMoveAccount(new Set(["t1", "t2"]), "a3", txns);
    expect(result.find((t) => t.id === "t1")!.accountId).toBe("a3");
    expect(result.find((t) => t.id === "t2")!.accountId).toBe("a3");
    expect(result.find((t) => t.id === "t3")!.accountId).toBe("a2"); // unchanged
  });

  it("skips transfers", () => {
    const result = bulkMoveAccount(new Set(["t4"]), "a3", txns);
    expect(result.find((t) => t.id === "t4")!.accountId).toBe("a1"); // unchanged
  });
});

describe("bulkChangeDate", () => {
  it("changes date while preserving time", () => {
    const result = bulkChangeDate(new Set(["t1", "t2"]), "2025-06-01", txns);
    expect(result.find((t) => t.id === "t1")!.datetime).toBe("2025-06-01T10:00:00");
    expect(result.find((t) => t.id === "t2")!.datetime).toBe("2025-06-01T10:00:00");
    expect(result.find((t) => t.id === "t3")!.datetime).toBe("2025-01-15T10:00:00"); // unchanged
  });
});

describe("bulkChangeMerchant", () => {
  it("changes merchant for non-transfer transactions", () => {
    const result = bulkChangeMerchant(new Set(["t1", "t3", "t4"]), "NewMerchant", txns);
    expect(result.find((t) => t.id === "t1")!.merchant).toBe("NewMerchant");
    expect(result.find((t) => t.id === "t3")!.merchant).toBe("NewMerchant");
    // Transfer should be unchanged
    expect(result.find((t) => t.id === "t4")!.merchant).toBe("");
  });
});
