import { describe, it, expect } from "vitest";
import type { Transaction } from "@capybudget/core";
import {
  bucketWindow,
  filterForCompareDrilldown,
  resolveClickedRow,
  type CompareChartRow,
} from "./compare-drilldown";
import { makeTransaction } from "@/test/factories";

describe("resolveClickedRow", () => {
  const rows: CompareChartRow[] = [
    { month: "Jan 2024", monthLabel: "Jan 2024", __start: "2024-01-01T00:00:00.000Z", __end: "2024-02-01T00:00:00.000Z", Groceries: 1500 },
    { month: "Feb 2024", monthLabel: "Feb 2024", __start: "2024-02-01T00:00:00.000Z", __end: "2024-03-01T00:00:00.000Z", Groceries: 1300 },
    { month: "Mar 2024", monthLabel: "Mar 2024", __start: "2024-03-01T00:00:00.000Z", __end: "2024-04-01T00:00:00.000Z", Groceries: 900 },
  ];

  // The shape a Recharts 3.8 LineChart wrapper onClick actually passes
  // (MouseHandlerDataParam) — no activePayload, just the index + label.
  function state(index: number, label: string) {
    return {
      activeTooltipIndex: index,
      activeIndex: index,
      activeLabel: label,
      isTooltipActive: true,
      activeDataKey: "Groceries",
      activeCoordinate: { x: 120, y: 80 },
    };
  }

  it("resolves the clicked row by activeTooltipIndex", () => {
    const s = state(1, "Feb 2024");
    expect(resolveClickedRow(rows, s.activeTooltipIndex, s.activeLabel)).toBe(rows[1]);
  });

  it("falls back to activeLabel when the index is missing", () => {
    expect(resolveClickedRow(rows, undefined, "Mar 2024")).toBe(rows[2]);
  });

  it("accepts a string-form tooltip index (TooltipIndex is string | null)", () => {
    // Recharts types activeTooltipIndex as `number | string | undefined`.
    expect(resolveClickedRow(rows, "0", "Jan 2024")).toBe(rows[0]);
  });

  it("returns null when neither index nor label resolves a row", () => {
    expect(resolveClickedRow(rows, 9, undefined)).toBeNull();
    expect(resolveClickedRow(rows, undefined, "Dec 2024")).toBeNull();
    expect(resolveClickedRow(rows, undefined, undefined)).toBeNull();
  });

  it("ignores an out-of-range index and uses the label fallback instead", () => {
    expect(resolveClickedRow(rows, 99, "Feb 2024")).toBe(rows[1]);
  });

  it("does not let null / empty-string indices coerce to row 0", () => {
    // `TooltipIndex` is `string | null`; Number(null) and Number("") are both
    // 0, which must NOT silently select the first bucket on an empty click.
    expect(resolveClickedRow(rows, null, undefined)).toBeNull();
    expect(resolveClickedRow(rows, "", undefined)).toBeNull();
  });
});

describe("bucketWindow", () => {
  it("monthly bucket: window spans the calendar month [first, next-first)", () => {
    const range = { start: new Date(2024, 0, 1), end: new Date(2024, 3, 1) };
    // Feb point — first-of-month ISO, as getCategoryTrends emits.
    const win = bucketWindow(new Date(2024, 1, 1).toISOString(), "month", range);
    expect(win.start).toEqual(new Date(2024, 1, 1));
    expect(win.end).toEqual(new Date(2024, 2, 1));
  });

  it("weekly bucket: window spans the Mon-anchored week [Mon, Mon+7)", () => {
    const range = { start: new Date(2024, 0, 1), end: new Date(2024, 2, 1) };
    // Mon Jan 8 → through Mon Jan 15 exclusive.
    const win = bucketWindow(new Date(2024, 0, 8).toISOString(), "week", range);
    expect(win.start).toEqual(new Date(2024, 0, 8));
    expect(win.end).toEqual(new Date(2024, 0, 15));
  });

  it("partial leading week: start clamps up to range.start when the range opens mid-week", () => {
    // Range opens Wed Jan 3. The week's Monday anchor is Jan 1 (before the
    // range), so the bucket's window must start at range.start, not Jan 1.
    const range = { start: new Date(2024, 0, 3), end: new Date(2024, 2, 1) };
    const win = bucketWindow(new Date(2024, 0, 1).toISOString(), "week", range);
    expect(win.start).toEqual(new Date(2024, 0, 3));
    expect(win.end).toEqual(new Date(2024, 0, 8));
  });

  it("partial trailing bucket: end clamps down to range.end", () => {
    // Range ends mid-February. The Feb monthly bucket's window must stop at
    // range.end, never reaching Mar 1.
    const range = { start: new Date(2024, 0, 1), end: new Date(2024, 1, 15) };
    const win = bucketWindow(new Date(2024, 1, 1).toISOString(), "month", range);
    expect(win.start).toEqual(new Date(2024, 1, 1));
    expect(win.end).toEqual(new Date(2024, 1, 15));
  });
});

describe("filterForCompareDrilldown", () => {
  // January window: [Jan 1, Feb 1)
  const janRange = {
    from: new Date(2024, 0, 1),
    to: new Date(2024, 1, 1),
  };

  const janGroceries = makeTransaction({
    id: "jan-groc",
    datetime: "2024-01-15T12:00:00.000Z",
    categoryId: "cat-1",
    type: "expense",
    amount: -1500,
  });
  const janGroceries2 = makeTransaction({
    id: "jan-groc-2",
    datetime: "2024-01-28T12:00:00.000Z",
    categoryId: "cat-1",
    type: "expense",
    amount: -800,
  });
  const janDining = makeTransaction({
    id: "jan-dining",
    datetime: "2024-01-10T12:00:00.000Z",
    categoryId: "cat-2",
    type: "expense",
    amount: -2000,
  });
  const janUnselected = makeTransaction({
    id: "jan-unsel",
    datetime: "2024-01-12T12:00:00.000Z",
    categoryId: "cat-3",
    type: "expense",
    amount: -500,
  });
  const janUncategorized = makeTransaction({
    id: "jan-uncat",
    datetime: "2024-01-20T12:00:00.000Z",
    categoryId: "",
    type: "expense",
    amount: -300,
  });
  const janIncome = makeTransaction({
    id: "jan-income",
    datetime: "2024-01-05T12:00:00.000Z",
    categoryId: "cat-1",
    type: "income",
    amount: 9000,
  });
  const janTransfer = makeTransaction({
    id: "jan-transfer",
    datetime: "2024-01-18T12:00:00.000Z",
    categoryId: "cat-1",
    type: "transfer",
    amount: -400,
  });
  const febGroceries = makeTransaction({
    id: "feb-groc",
    datetime: "2024-02-03T12:00:00.000Z",
    categoryId: "cat-1",
    type: "expense",
    amount: -1200,
  });
  const decGroceries = makeTransaction({
    id: "dec-groc",
    datetime: "2023-12-30T12:00:00.000Z",
    categoryId: "cat-1",
    type: "expense",
    amount: -1100,
  });

  const txns: Transaction[] = [
    janGroceries,
    janGroceries2,
    janDining,
    janUnselected,
    janUncategorized,
    janIncome,
    janTransfer,
    febGroceries,
    decGroceries,
  ];

  it("filters to the bucket's date window — excludes adjacent periods", () => {
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-1"],
      mode: "expense",
    });
    expect(out.map((t) => t.id).sort()).toEqual(["jan-groc", "jan-groc-2"]);
  });

  it("includes only the selected category set", () => {
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-1", "cat-2"],
      mode: "expense",
    });
    expect(out.map((t) => t.id).sort()).toEqual(["jan-dining", "jan-groc", "jan-groc-2"]);
    // cat-3 is unselected and must not appear.
    expect(out.find((t) => t.id === "jan-unsel")).toBeUndefined();
  });

  it("matches the Uncategorized bucket via the empty-string id", () => {
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: [""],
      mode: "expense",
    });
    expect(out.map((t) => t.id)).toEqual(["jan-uncat"]);
  });

  it("respects the income view mode", () => {
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-1"],
      mode: "income",
    });
    expect(out.map((t) => t.id)).toEqual(["jan-income"]);
  });

  it("excludes transfers — they match neither expense nor income mode", () => {
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-1"],
      mode: "expense",
    });
    expect(out.find((t) => t.id === "jan-transfer")).toBeUndefined();
  });

  it("returns empty when nothing matches the range/category/type combination", () => {
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-1"],
      mode: "income",
    });
    // Only jan-income matches; flip to a category with no income for empty.
    const empty = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-2"],
      mode: "income",
    });
    expect(out.length).toBe(1);
    expect(empty).toEqual([]);
  });

  it("sums to the per-category tooltip value for a single category in a month", () => {
    // The Compare tooltip shows abs cents per category per bucket. The
    // drilled-down sum for that same (category, bucket, type) must equal it.
    const out = filterForCompareDrilldown(txns, {
      label: "Jan 2024",
      range: janRange,
      categoryIds: ["cat-1"],
      mode: "expense",
    });
    const sum = out.reduce((s, t) => s + Math.abs(t.amount), 0);
    expect(sum).toBe(1500 + 800);
  });
});
