import { describe, it, expect } from "vitest";
import type { Category, DateRange, Transaction } from "@capybudget/core";
import {
  budgetDrilldownTitle,
  filterForBudgetDrilldown,
  partitionCategoriesForBudget,
} from "./monthly-budget-drilldown";
import { makeAccount, makeCategory, makeTransaction } from "@/test/factories";

// Build a stable category set covering every partition we care about:
// tracked (assigned !== null), untracked (assigned === null), archived
// (dropped), and Income (dropped). Each gets one or more expenses inside
// May 2026 plus noise outside it.
const acc = makeAccount({ id: "acc", name: "Checking" });

const trackedGroceries = makeCategory({
  id: "cat-groceries",
  name: "Groceries",
  group: "Daily Living",
  assigned: 50000, // tracked
});
const trackedRent = makeCategory({
  id: "cat-rent",
  name: "Rent",
  group: "Fixed",
  assigned: 200000, // tracked
});
const untrackedSubs = makeCategory({
  id: "cat-subs",
  name: "Subscriptions",
  group: "Personal",
  assigned: null, // untracked
});
const untrackedGifts = makeCategory({
  id: "cat-gifts",
  name: "Gifts",
  group: "Personal",
  assigned: null, // untracked
});
const archivedOld = makeCategory({
  id: "cat-archived",
  name: "Old",
  group: "Fixed",
  archived: true,
  assigned: 1000,
});
const incomeSalary = makeCategory({
  id: "cat-salary",
  name: "Salary",
  group: "Income",
  assigned: null,
});

const categories: Category[] = [
  trackedGroceries,
  trackedRent,
  untrackedSubs,
  untrackedGifts,
  archivedOld,
  incomeSalary,
];

// May 2026 date range — exclusive end (Jun 1).
const may2026: DateRange = {
  start: new Date(2026, 4, 1),
  end: new Date(2026, 5, 1),
};

const inMay = (day: number) =>
  new Date(2026, 4, day, 12, 0, 0).toISOString();
const inApril = (day: number) =>
  new Date(2026, 3, day, 12, 0, 0).toISOString();

const txns: Transaction[] = [
  // Tracked expenses in range
  makeTransaction({
    id: "g1",
    accountId: acc.id,
    categoryId: trackedGroceries.id,
    type: "expense",
    amount: -1500,
    datetime: inMay(5),
  }),
  makeTransaction({
    id: "g2",
    accountId: acc.id,
    categoryId: trackedGroceries.id,
    type: "expense",
    amount: -800,
    datetime: inMay(12),
  }),
  makeTransaction({
    id: "r1",
    accountId: acc.id,
    categoryId: trackedRent.id,
    type: "expense",
    amount: -200000,
    datetime: inMay(1),
  }),
  // Untracked expenses in range
  makeTransaction({
    id: "s1",
    accountId: acc.id,
    categoryId: untrackedSubs.id,
    type: "expense",
    amount: -1000,
    datetime: inMay(10),
  }),
  makeTransaction({
    id: "gf1",
    accountId: acc.id,
    categoryId: untrackedGifts.id,
    type: "expense",
    amount: -2500,
    datetime: inMay(20),
  }),
  // Income (must never appear in any drilldown)
  makeTransaction({
    id: "sal",
    accountId: acc.id,
    categoryId: incomeSalary.id,
    type: "income",
    amount: 500000,
    datetime: inMay(15),
  }),
  // Out-of-range expense (April) — must never appear
  makeTransaction({
    id: "apr",
    accountId: acc.id,
    categoryId: trackedGroceries.id,
    type: "expense",
    amount: -700,
    datetime: inApril(28),
  }),
  // Archived-category expense in range — currently passes
  // (archived categories drop from the budget rows but their txns still
  // exist; `getMonthlyBudgetSummary` skips them via the `eligible` filter).
  // The drilldown must do the same: an archived expense should NOT appear
  // in tracked / other buckets.
  makeTransaction({
    id: "old",
    accountId: acc.id,
    categoryId: archivedOld.id,
    type: "expense",
    amount: -50,
    datetime: inMay(7),
  }),
  // Uncategorized expense — outside the budget partition (no categoryId).
  makeTransaction({
    id: "uncat",
    accountId: acc.id,
    categoryId: "",
    type: "expense",
    amount: -999,
    datetime: inMay(3),
  }),
];

describe("partitionCategoriesForBudget", () => {
  const partition = partitionCategoriesForBudget(categories);

  it("puts non-archived non-Income categories with assigned !== null into trackedIds", () => {
    expect(partition.trackedIds.has(trackedGroceries.id)).toBe(true);
    expect(partition.trackedIds.has(trackedRent.id)).toBe(true);
  });

  it("puts non-archived non-Income categories with assigned === null into untrackedIds", () => {
    expect(partition.untrackedIds.has(untrackedSubs.id)).toBe(true);
    expect(partition.untrackedIds.has(untrackedGifts.id)).toBe(true);
  });

  it("excludes archived categories from both sets", () => {
    expect(partition.trackedIds.has(archivedOld.id)).toBe(false);
    expect(partition.untrackedIds.has(archivedOld.id)).toBe(false);
  });

  it("excludes Income-group categories from both sets", () => {
    expect(partition.trackedIds.has(incomeSalary.id)).toBe(false);
    expect(partition.untrackedIds.has(incomeSalary.id)).toBe(false);
  });
});

describe("filterForBudgetDrilldown", () => {
  const partition = partitionCategoriesForBudget(categories);

  describe("kind: category", () => {
    it("returns only expenses for the chosen category in range", () => {
      const out = filterForBudgetDrilldown(
        txns,
        may2026,
        { kind: "category", category: trackedGroceries },
        partition,
      );
      expect(out.map((t) => t.id).sort()).toEqual(["g1", "g2"]);
      expect(out.find((t) => t.id === "apr")).toBeUndefined(); // out of range
    });
  });

  describe("kind: tracked", () => {
    const out = filterForBudgetDrilldown(txns, may2026, { kind: "tracked" }, partition);

    it("returns expenses across every tracked category", () => {
      expect(out.map((t) => t.id).sort()).toEqual(["g1", "g2", "r1"]);
    });

    it("excludes untracked-category expenses", () => {
      expect(out.find((t) => t.id === "s1")).toBeUndefined();
      expect(out.find((t) => t.id === "gf1")).toBeUndefined();
    });

    it("excludes income, uncategorized, archived, and out-of-range entries", () => {
      expect(out.find((t) => t.id === "sal")).toBeUndefined();
      expect(out.find((t) => t.id === "uncat")).toBeUndefined();
      expect(out.find((t) => t.id === "old")).toBeUndefined();
      expect(out.find((t) => t.id === "apr")).toBeUndefined();
    });
  });

  describe("kind: other", () => {
    const out = filterForBudgetDrilldown(txns, may2026, { kind: "other" }, partition);

    it("returns expenses across every untracked category", () => {
      expect(out.map((t) => t.id).sort()).toEqual(["gf1", "s1"]);
    });

    it("excludes tracked-category expenses", () => {
      expect(out.find((t) => t.id === "g1")).toBeUndefined();
      expect(out.find((t) => t.id === "r1")).toBeUndefined();
    });

    it("excludes income, uncategorized, archived, and out-of-range entries", () => {
      expect(out.find((t) => t.id === "sal")).toBeUndefined();
      expect(out.find((t) => t.id === "uncat")).toBeUndefined();
      expect(out.find((t) => t.id === "old")).toBeUndefined();
      expect(out.find((t) => t.id === "apr")).toBeUndefined();
    });
  });
});

describe("budgetDrilldownTitle", () => {
  it("uses the category name for kind: category", () => {
    expect(
      budgetDrilldownTitle({ kind: "category", category: trackedGroceries }),
    ).toBe("Groceries");
  });

  it("uses the KPI labels for the bucket drilldowns", () => {
    expect(budgetDrilldownTitle({ kind: "tracked" })).toBe("Spent (tracked)");
    expect(budgetDrilldownTitle({ kind: "other" })).toBe("Other Spending");
  });
});
