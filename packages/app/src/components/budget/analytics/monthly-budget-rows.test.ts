import { describe, expect, it } from "vitest";
import type {
  Category,
  CategoryHistoricalStatsResult,
  MonthlyBudgetSummary,
  Transaction,
} from "@capybudget/core";
import { buildBudgetView, mergeBudgetView } from "./monthly-budget-rows";

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

describe("buildBudgetView — basis forwarding", () => {
  // Viewed May 2026, one category. Spend differs between the trailing window
  // and the same-month-last-year window so the chosen basis is observable in
  // the resulting `reference`.
  const cats: Category[] = [
    { id: "x", name: "X", group: "Fixed", archived: false, sortOrder: 0, assigned: null },
  ];
  const exp = (amount: number, datetime: string): Transaction => ({
    id: datetime,
    type: "expense",
    accountId: "a",
    categoryId: "x",
    transferPairId: "",
    merchant: "",
    note: "",
    createdAt: "",
    amount,
    datetime,
  });
  const at = (y: number, m: number) => new Date(y, m, 15, 12, 0).toISOString();
  const range = { start: new Date(2026, 4, 1), end: new Date(2026, 5, 1) };
  const txns: Transaction[] = [
    exp(-30000, at(2026, 3)), // Apr 2026 — in the trailing-3 window
    exp(-20000, at(2026, 2)), // Mar 2026 — in the trailing-3 window
    exp(-10000, at(2026, 1)), // Feb 2026 — in the trailing-3 window
    exp(-90000, at(2025, 4)), // May 2025 — the same-month-last-year reference
  ];

  it("defaults to trailing3 when no basis is given", () => {
    const { rows } = buildBudgetView(txns, cats, range);
    // (30000 + 20000 + 10000) / 3 active = 20000.
    expect(rows.find((r) => r.categoryId === "x")!.reference).toBe(20000);
  });

  it("forwards the basis through to getCategoryHistoricalStats", () => {
    const trailing6 = buildBudgetView(txns, cats, range, "trailing6").rows.find((r) => r.categoryId === "x")!;
    // Trailing-6 window (Nov 2025–Apr 2026) only has the three 2026 active
    // months → same active-month average as trailing3 here (20000), and
    // crucially NOT the May-2025 seasonal value.
    expect(trailing6.reference).toBe(20000);

    const seasonal = buildBudgetView(txns, cats, range, "sameMonthLastYear").rows.find((r) => r.categoryId === "x")!;
    // Same-month-last-year = May 2025 alone = 90000.
    expect(seasonal.reference).toBe(90000);
  });
});
