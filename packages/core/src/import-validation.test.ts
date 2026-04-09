import { describe, it, expect } from "vitest";
import { validateImportTransactions } from "./import-validation";
import type { ImportTransaction } from "./import-types";

function makeRow(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id: "row-1",
    date: "2025-03-15",
    description: "Coffee shop",
    amount: -450,
    type: "expense",
    sourceAccount: "Checking",
    sourceCategory: "",
    memo: "",
    merchant: "Starbucks",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
    ...overrides,
  };
}

describe("validateImportTransactions", () => {
  it("passes a valid row through unchanged", () => {
    const row = makeRow();
    const { valid, warnings } = validateImportTransactions([row]);
    expect(valid).toEqual([row]);
    expect(warnings).toHaveLength(0);
  });

  it("auto-generates id when missing", () => {
    const row = makeRow({ id: "" });
    const { valid, warnings } = validateImportTransactions([row]);
    expect(valid).toHaveLength(1);
    expect(valid[0].id).toBeTruthy();
    expect(valid[0].id).not.toBe("");
    expect(warnings).toEqual([expect.stringContaining("missing id")]);
  });

  it("drops row with invalid date", () => {
    const { valid, warnings } = validateImportTransactions([
      makeRow({ date: "March 15" }),
    ]);
    expect(valid).toHaveLength(0);
    expect(warnings).toEqual([expect.stringContaining("invalid date")]);
  });

  it("drops row with NaN amount", () => {
    const { valid, warnings } = validateImportTransactions([
      makeRow({ amount: NaN }),
    ]);
    expect(valid).toHaveLength(0);
    expect(warnings).toEqual([expect.stringContaining("invalid amount")]);
  });

  it("drops row with float amount", () => {
    const { valid, warnings } = validateImportTransactions([
      makeRow({ amount: 12.5 }),
    ]);
    expect(valid).toHaveLength(0);
    expect(warnings).toEqual([expect.stringContaining("invalid amount")]);
  });

  it("drops row with invalid type", () => {
    const { valid, warnings } = validateImportTransactions([
      makeRow({ type: "refund" as ImportTransaction["type"] }),
    ]);
    expect(valid).toHaveLength(0);
    expect(warnings).toEqual([expect.stringContaining("invalid type")]);
  });

  it("skips completely empty rows silently", () => {
    const empty = makeRow({
      id: "",
      date: "",
      description: "",
      amount: 0,
      type: "" as ImportTransaction["type"],
      sourceAccount: "",
      merchant: "",
    });
    const { valid, warnings } = validateImportTransactions([empty]);
    expect(valid).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("handles mix of valid, fixable, and invalid rows", () => {
    const rows = [
      makeRow({ id: "a" }),
      makeRow({ id: "", date: "2025-01-01", amount: -100 }),
      makeRow({ id: "c", date: "bad" }),
      makeRow({ id: "d", amount: NaN }),
    ];
    const { valid, warnings } = validateImportTransactions(rows);
    expect(valid).toHaveLength(2); // first row OK, second auto-fixed
    expect(valid[0].id).toBe("a");
    expect(valid[1].id).not.toBe(""); // auto-generated
    expect(warnings).toHaveLength(3); // auto-fix + 2 drops
  });

  it("accepts zero amount as valid", () => {
    const { valid } = validateImportTransactions([makeRow({ amount: 0 })]);
    expect(valid).toHaveLength(1);
  });

  it("accepts transfer type", () => {
    const { valid } = validateImportTransactions([makeRow({ type: "transfer" })]);
    expect(valid).toHaveLength(1);
  });

  it("accepts income type", () => {
    const { valid } = validateImportTransactions([makeRow({ type: "income" })]);
    expect(valid).toHaveLength(1);
  });
});
