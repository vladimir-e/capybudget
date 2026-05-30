import { describe, expect, it } from "vitest";
import type {
  CategoryHistoricalStatsResult,
  MonthlyBudgetSummary,
} from "@capybudget/core";
import { mergeBudgetView } from "./monthly-budget-rows";

function stats(
  entries: Array<[string, { lastMonth: number; reference: number; implicitTarget: number | null }]>,
  monthsOfData: number,
): CategoryHistoricalStatsResult {
  return {
    byCategory: new Map(
      entries.map(([id, s]) => [id, { categoryId: id, ...s }]),
    ),
    monthsOfData,
  };
}

describe("mergeBudgetView", () => {
  const summary: MonthlyBudgetSummary = {
    rows: [
      { categoryId: "explicit", assigned: 10000, spent: 8000 }, // under explicit
      { categoryId: "implicit", assigned: null, spent: 12000 }, // over implicit
      { categoryId: "untargeted", assigned: null, spent: 4000 }, // no target
      { categoryId: "explicit-zero", assigned: 0, spent: 500 }, // strict over
    ],
  };

  const histStats = stats(
    [
      ["explicit", { lastMonth: 9000, reference: 9500, implicitTarget: 9500 }],
      ["implicit", { lastMonth: 10000, reference: 11000, implicitTarget: 11000 }],
      ["untargeted", { lastMonth: 0, reference: 0, implicitTarget: null }],
      ["explicit-zero", { lastMonth: 0, reference: 0, implicitTarget: null }],
    ],
    3,
  );

  it("carries history and target fields onto every row", () => {
    const { rows } = mergeBudgetView(summary, histStats);
    const byId = new Map(rows.map((r) => [r.categoryId, r]));

    const implicit = byId.get("implicit")!;
    expect(implicit.lastMonth).toBe(10000);
    expect(implicit.reference).toBe(11000);
    expect(implicit.implicitTarget).toBe(11000);
    expect(implicit.effectiveTarget).toBe(11000);
    expect(implicit.isImplicit).toBe(true);
  });

  it("uses explicit assigned as the effective target when set", () => {
    const { rows } = mergeBudgetView(summary, histStats);
    const explicit = rows.find((r) => r.categoryId === "explicit")!;
    expect(explicit.effectiveTarget).toBe(10000); // assigned, not implicit 9500
    expect(explicit.isImplicit).toBe(false);
  });

  it("marks rows with neither budget nor history as untargeted", () => {
    const { rows } = mergeBudgetView(summary, histStats);
    const untargeted = rows.find((r) => r.categoryId === "untargeted")!;
    expect(untargeted.effectiveTarget).toBeNull();
    expect(untargeted.isImplicit).toBe(false);
  });

  it("does not mark an explicit-zero row as implicit", () => {
    const { rows } = mergeBudgetView(summary, histStats);
    const zero = rows.find((r) => r.categoryId === "explicit-zero")!;
    expect(zero.effectiveTarget).toBe(0);
    expect(zero.isImplicit).toBe(false);
  });

  it("sums totalTargeted over effective targets (untargeted rows contribute 0)", () => {
    const { totalTargeted } = mergeBudgetView(summary, histStats);
    // explicit 10000 + implicit 11000 + untargeted 0 + explicit-zero 0
    expect(totalTargeted).toBe(21000);
  });

  it("retains totalAssigned and totalSpent", () => {
    const { totalAssigned, totalSpent } = mergeBudgetView(summary, histStats);
    expect(totalAssigned).toBe(10000); // only explicit + explicit-zero(0)
    expect(totalSpent).toBe(8000 + 12000 + 4000 + 500);
  });

  it("counts rows strictly over their effective target", () => {
    const { overCount } = mergeBudgetView(summary, histStats);
    // implicit (12000 > 11000) and explicit-zero (500 > 0). explicit is under,
    // untargeted never counts.
    expect(overCount).toBe(2);
  });

  it("passes monthsOfData through", () => {
    expect(mergeBudgetView(summary, histStats).monthsOfData).toBe(3);
  });

  it("defaults missing stats to zero/neutral", () => {
    const { rows } = mergeBudgetView(summary, stats([], 0));
    const implicit = rows.find((r) => r.categoryId === "implicit")!;
    expect(implicit.lastMonth).toBe(0);
    expect(implicit.reference).toBe(0);
    expect(implicit.implicitTarget).toBeNull();
    expect(implicit.effectiveTarget).toBeNull();
    expect(implicit.isImplicit).toBe(false);
  });
});
