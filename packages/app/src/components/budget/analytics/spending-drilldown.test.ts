import { describe, it, expect } from "vitest";
import type { Transaction } from "@capybudget/core";
import {
  buildSliceDrilldown,
  filterForSliceDrilldown,
} from "./spending-drilldown";
import { makeTransaction } from "@/test/factories";

describe("buildSliceDrilldown", () => {
  it("captures viewMode at click time so a later toggle doesn't reinterpret the open drilldown", () => {
    const slice = { categoryId: "cat-1", name: "Groceries" };
    expect(buildSliceDrilldown(slice, "expenses")).toEqual({
      categoryId: "cat-1",
      categoryName: "Groceries",
      mode: "expenses",
    });
    expect(buildSliceDrilldown(slice, "income")).toEqual({
      categoryId: "cat-1",
      categoryName: "Groceries",
      mode: "income",
    });
  });

  it("preserves the Uncategorized synthetic id ('') as-is", () => {
    expect(buildSliceDrilldown({ categoryId: "", name: "Uncategorized" }, "expenses").categoryId).toBe("");
  });
});

describe("filterForSliceDrilldown", () => {
  const groceriesExpense = makeTransaction({
    id: "ge1",
    categoryId: "cat-1",
    type: "expense",
    amount: -1500,
  });
  const groceriesExpense2 = makeTransaction({
    id: "ge2",
    categoryId: "cat-1",
    type: "expense",
    amount: -800,
  });
  const groceriesIncome = makeTransaction({
    id: "gi",
    categoryId: "cat-1",
    type: "income",
    amount: 50,
  });
  const housingExpense = makeTransaction({
    id: "h",
    categoryId: "cat-2",
    type: "expense",
    amount: -185000,
  });
  const transferTxn: Transaction = makeTransaction({
    id: "t",
    categoryId: "cat-1",
    type: "transfer",
    amount: -500,
  });

  const txns: Transaction[] = [
    groceriesExpense,
    groceriesExpense2,
    groceriesIncome,
    housingExpense,
    transferTxn,
  ];

  it("returns only matching category + expense when mode = expenses", () => {
    const out = filterForSliceDrilldown(txns, {
      categoryId: "cat-1",
      categoryName: "Groceries",
      mode: "expenses",
    });
    expect(out.map((t) => t.id).sort()).toEqual(["ge1", "ge2"]);
  });

  it("returns only matching category + income when mode = income", () => {
    const out = filterForSliceDrilldown(txns, {
      categoryId: "cat-1",
      categoryName: "Groceries",
      mode: "income",
    });
    expect(out.map((t) => t.id)).toEqual(["gi"]);
  });

  it("excludes transfers regardless of category match", () => {
    const out = filterForSliceDrilldown(txns, {
      categoryId: "cat-1",
      categoryName: "Groceries",
      mode: "expenses",
    });
    expect(out.find((t) => t.id === "t")).toBeUndefined();
  });

  it("returns empty when no transactions match", () => {
    const out = filterForSliceDrilldown(txns, {
      categoryId: "nonexistent",
      categoryName: "Missing",
      mode: "expenses",
    });
    expect(out).toEqual([]);
  });
});
