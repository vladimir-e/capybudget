import { describe, it, expect } from "vitest";
import {
  bulkDeleteTransactions,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
} from "./bulk-transactions";
import type { Transaction } from "./types";

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
    const result = bulkMoveAccount(new Set(["t1", "t2"]), "a3", undefined, txns);
    expect(result.find((t) => t.id === "t1")!.accountId).toBe("a3");
    expect(result.find((t) => t.id === "t2")!.accountId).toBe("a3");
    expect(result.find((t) => t.id === "t3")!.accountId).toBe("a2"); // unchanged
  });

  it("re-stamps the target account's rate onto every moved transaction", () => {
    // Moving USD-stamped and rate-less txns into one ₽-default-world IDR account
    // (rate 0.005): they all land on one account, so all take its one rate.
    const mixed: Transaction[] = [
      { ...base, id: "m1", type: "expense", amount: -500, categoryId: "c1", accountId: "a1", fxRate: 90 },
      { ...base, id: "m2", type: "income", amount: 1000, categoryId: "c2", accountId: "a1" },
    ];
    const result = bulkMoveAccount(new Set(["m1", "m2"]), "a-idr", 0.005, mixed);
    expect(result.find((t) => t.id === "m1")!.fxRate).toBe(0.005);
    expect(result.find((t) => t.id === "m2")!.fxRate).toBe(0.005);
  });

  it("clears fxRate when moving to a default-currency account", () => {
    // A foreign-stamped txn moved to the default currency must drop its stamp —
    // the caller resolves the default target's rate as undefined.
    const foreign: Transaction[] = [
      { ...base, id: "f1", type: "expense", amount: -500, categoryId: "c1", accountId: "a-usd", fxRate: 90 },
    ];
    const result = bulkMoveAccount(new Set(["f1"]), "a-default", undefined, foreign);
    expect(result.find((t) => t.id === "f1")!.fxRate).toBeUndefined();
  });

  it("skips transfers (neither account nor rate touched)", () => {
    const result = bulkMoveAccount(new Set(["t4"]), "a3", 0.005, txns);
    const t4 = result.find((t) => t.id === "t4")!;
    expect(t4.accountId).toBe("a1"); // unchanged
    expect(t4.fxRate).toBeUndefined(); // not re-stamped
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
