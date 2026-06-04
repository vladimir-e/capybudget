import { describe, it, expect } from "vitest";
import { makeAccount, makeCategory, makeTransaction as makeTxn } from "../test-factories";
import {
  groupTransactions,
  computeCadence,
  median,
  type GroupContext,
} from "./group";

const accounts = [
  makeAccount({ id: "acc-1", name: "Chase Checking" }),
  makeAccount({ id: "acc-2", name: "Amex Gold" }),
];
const categories = [
  makeCategory({ id: "cat-groc", name: "Groceries" }),
  makeCategory({ id: "cat-dine", name: "Dining Out" }),
];
const ctx: GroupContext = { accounts, categories };

// ── median (shared statistic) ───────────────────────────────────────────

describe("median", () => {
  it("returns the middle of an odd-count set", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middles of an even-count set", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("handles a single element", () => {
    expect(median([7])).toBe(7);
  });

  it("returns 0 for empty input", () => {
    expect(median([])).toBe(0);
  });

  it("works on negative (signed) values", () => {
    expect(median([-100, -50, -200])).toBe(-100);
  });
});

// ── groupBy dimensions ──────────────────────────────────────────────────

describe("groupTransactions — dimensions", () => {
  it("groups by category with a resolved label and raw id", () => {
    const txns = [
      makeTxn({ categoryId: "cat-groc", amount: -1000 }),
      makeTxn({ categoryId: "cat-groc", amount: -2000 }),
      makeTxn({ categoryId: "cat-dine", amount: -500 }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["category"], metrics: ["sum", "count"], sortByMetric: "count" },
      ctx,
    );
    const groc = groups.find((g) => g.key[0].id === "cat-groc")!;
    expect(groc.key[0]).toEqual({ dimension: "category", label: "Groceries", id: "cat-groc" });
    expect(groc.sum).toBe(-3000);
    expect(groc.count).toBe(2);
  });

  it("labels an empty categoryId 'Uncategorized' but keeps an orphaned id visible", () => {
    // Mirrors the verbose-row convention: a blank id is genuinely
    // uncategorized; a stale/deleted reference keeps its raw id as the label
    // so the data oddity stays surfaced rather than silently merged in.
    const txns = [makeTxn({ categoryId: "" }), makeTxn({ categoryId: "cat-deleted" })];
    const groups = groupTransactions(txns, { groupBy: ["category"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].id === "")?.key[0].label).toBe("Uncategorized");
    expect(groups.find((g) => g.key[0].id === "cat-deleted")?.key[0].label).toBe("cat-deleted");
  });

  it("groups by merchant", () => {
    const txns = [
      makeTxn({ merchant: "Whole Foods" }),
      makeTxn({ merchant: "Whole Foods" }),
      makeTxn({ merchant: "Nobu" }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["merchant"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].label === "Whole Foods")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "Nobu")?.count).toBe(1);
  });

  it("labels a blank merchant as (none)", () => {
    const groups = groupTransactions(
      [makeTxn({ merchant: "" })],
      { groupBy: ["merchant"], metrics: ["count"] },
      ctx,
    );
    expect(groups[0].key[0].label).toBe("(none)");
  });

  it("groups by account with label and id", () => {
    const txns = [
      makeTxn({ accountId: "acc-1" }),
      makeTxn({ accountId: "acc-2" }),
      makeTxn({ accountId: "acc-2" }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["account"], metrics: ["count"] }, ctx);
    const amex = groups.find((g) => g.key[0].id === "acc-2")!;
    expect(amex.key[0].label).toBe("Amex Gold");
    expect(amex.count).toBe(2);
  });

  it("groups by type", () => {
    const txns = [
      makeTxn({ type: "expense", amount: -100 }),
      makeTxn({ type: "income", amount: 5000 }),
      makeTxn({ type: "expense", amount: -200 }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["type"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].label === "expense")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "income")?.count).toBe(1);
  });

  it("groups by month (YYYY-MM from the date prefix)", () => {
    const txns = [
      makeTxn({ datetime: "2026-01-15T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-01-28T09:00:00.000Z" }),
      makeTxn({ datetime: "2026-02-03T18:00:00.000Z" }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["month"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].label === "2026-01")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "2026-02")?.count).toBe(1);
  });

  it("groups by dayOfMonth (1–31, no leading zero)", () => {
    const txns = [
      makeTxn({ datetime: "2026-01-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-02-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-03-15T12:00:00.000Z" }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["dayOfMonth"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].label === "5")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "15")?.count).toBe(1);
  });

  it("groups by ISO week (YYYY-Www)", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026. 2026-01-05 is the Monday
    // of ISO week 2.
    const txns = [
      makeTxn({ datetime: "2026-01-01T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-01-02T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-01-05T12:00:00.000Z" }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["week"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].label === "2026-W01")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "2026-W02")?.count).toBe(1);
  });

  it("assigns Jan 1 2025 (a Wednesday) to ISO week 1 of 2025", () => {
    const groups = groupTransactions(
      [makeTxn({ datetime: "2025-01-01T12:00:00.000Z" })],
      { groupBy: ["week"], metrics: ["count"] },
      ctx,
    );
    expect(groups[0].key[0].label).toBe("2025-W01");
  });

  it("rolls a late-December date into the next year's ISO W01", () => {
    // 2025-12-29 is the Monday of the ISO week whose Thursday (Jan 1 2026)
    // falls in 2026 — so the week-year is 2026, not 2025.
    const groups = groupTransactions(
      [makeTxn({ datetime: "2025-12-29T12:00:00.000Z" })],
      { groupBy: ["week"], metrics: ["count"] },
      ctx,
    );
    expect(groups[0].key[0].label).toBe("2026-W01");
  });
});

// ── amountBucket ────────────────────────────────────────────────────────

describe("groupTransactions — amountBucket", () => {
  it("groups by exact amount when no bucket size is given (duplicate detection)", () => {
    const txns = [
      makeTxn({ amount: -1299 }),
      makeTxn({ amount: -1299 }),
      makeTxn({ amount: -500 }),
    ];
    const groups = groupTransactions(txns, { groupBy: ["amountBucket"], metrics: ["count"] }, ctx);
    expect(groups.find((g) => g.key[0].label === "-1299")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "-500")?.count).toBe(1);
  });

  it("buckets by a fixed cent size, flooring toward negative infinity", () => {
    const txns = [
      makeTxn({ amount: -150 }),
      makeTxn({ amount: -199 }),
      makeTxn({ amount: -100 }),
      makeTxn({ amount: 50 }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["amountBucket"], metrics: ["count"], amountBucketCents: 100 },
      ctx,
    );
    // -150 and -199 land in [-200,-100); -100 lands in [-100,0); 50 in [0,100)
    expect(groups.find((g) => g.key[0].label === "-200..-100")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].label === "-100..0")?.count).toBe(1);
    expect(groups.find((g) => g.key[0].label === "0..100")?.count).toBe(1);
  });
});

// ── multi-key grouping ──────────────────────────────────────────────────

describe("groupTransactions — multi-key", () => {
  it("groups by [merchant, dayOfMonth]", () => {
    const txns = [
      makeTxn({ merchant: "Netflix", datetime: "2026-01-05T12:00:00.000Z" }),
      makeTxn({ merchant: "Netflix", datetime: "2026-02-05T12:00:00.000Z" }),
      makeTxn({ merchant: "Netflix", datetime: "2026-01-20T12:00:00.000Z" }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["merchant", "dayOfMonth"], metrics: ["count"] },
      ctx,
    );
    const day5 = groups.find((g) => g.key[1].label === "5")!;
    expect(day5.key.map((p) => p.label)).toEqual(["Netflix", "5"]);
    expect(day5.count).toBe(2);
    expect(groups.find((g) => g.key[1].label === "20")?.count).toBe(1);
  });

  it("keeps two accounts that share a display name in separate groups", () => {
    const dupAccounts = [
      makeAccount({ id: "acc-a", name: "Savings" }),
      makeAccount({ id: "acc-b", name: "Savings" }),
    ];
    const txns = [
      makeTxn({ accountId: "acc-a" }),
      makeTxn({ accountId: "acc-b" }),
      makeTxn({ accountId: "acc-a" }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["account"], metrics: ["count"] },
      { accounts: dupAccounts, categories },
    );
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.key[0].id === "acc-a")?.count).toBe(2);
    expect(groups.find((g) => g.key[0].id === "acc-b")?.count).toBe(1);
  });

  it("does not collide multi-key combos when a label contains the separator", () => {
    // [merchant, type]: "A B"+expense vs "A"+(a merchant literally "B income")
    // must not merge. A printable join separator would risk this; a NUL won't.
    const txns = [
      makeTxn({ merchant: "A B", type: "expense" }),
      makeTxn({ merchant: "A", type: "income", amount: 100 }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["merchant", "type"], metrics: ["count"] },
      ctx,
    );
    expect(groups).toHaveLength(2);
  });

  it("groups by [amountBucket, month] for duplicate clustering", () => {
    const txns = [
      makeTxn({ amount: -999, datetime: "2026-01-10T12:00:00.000Z" }),
      makeTxn({ amount: -999, datetime: "2026-01-11T12:00:00.000Z" }),
      makeTxn({ amount: -999, datetime: "2026-02-10T12:00:00.000Z" }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["amountBucket", "month"], metrics: ["count"] },
      ctx,
    );
    const janDup = groups.find(
      (g) => g.key[0].label === "-999" && g.key[1].label === "2026-01",
    )!;
    expect(janDup.count).toBe(2);
    expect(groups).toHaveLength(2);
  });
});

// ── metrics ─────────────────────────────────────────────────────────────

describe("groupTransactions — metrics", () => {
  const txns = [
    makeTxn({ merchant: "X", amount: -100, accountId: "acc-1", categoryId: "cat-groc" }),
    makeTxn({ merchant: "Y", amount: -300, accountId: "acc-2", categoryId: "cat-dine" }),
    makeTxn({ merchant: "X", amount: -200, accountId: "acc-1", categoryId: "cat-groc" }),
  ];

  function single(metric: Parameters<typeof groupTransactions>[1]["metrics"][number]) {
    // No groupBy keys → every row falls into one group.
    return groupTransactions(txns, { groupBy: [], metrics: [metric] }, ctx)[0];
  }

  it("count", () => expect(single("count").count).toBe(3));
  it("sum is signed (spending sums negative)", () => expect(single("sum").sum).toBe(-600));
  it("avg over signed amounts", () => expect(single("avg").avg).toBe(-200));
  it("min is the most-negative", () => expect(single("min").min).toBe(-300));
  it("max is the least-negative", () => expect(single("max").max).toBe(-100));
  it("median over signed amounts", () => expect(single("median").median).toBe(-200));
  it("distinctMerchants", () => expect(single("distinctMerchants").distinctMerchants).toBe(2));
  it("distinctAccounts", () => expect(single("distinctAccounts").distinctAccounts).toBe(2));
  it("distinctCategories", () => expect(single("distinctCategories").distinctCategories).toBe(2));
  it("distinctAmounts", () => expect(single("distinctAmounts").distinctAmounts).toBe(3));

  it("median averages two middles on an even-count group", () => {
    const even = [
      makeTxn({ amount: -100 }),
      makeTxn({ amount: -200 }),
      makeTxn({ amount: -300 }),
      makeTxn({ amount: -400 }),
    ];
    const g = groupTransactions(even, { groupBy: [], metrics: ["median"] }, ctx)[0];
    expect(g.median).toBe(-250);
  });

  it("computes multiple metrics in one pass", () => {
    const g = single("count");
    const multi = groupTransactions(
      txns,
      { groupBy: [], metrics: ["count", "sum", "avg"] },
      ctx,
    )[0];
    expect(multi.count).toBe(g.count);
    expect(multi.sum).toBe(-600);
    expect(multi.avg).toBe(-200);
  });
});

// ── cadence ─────────────────────────────────────────────────────────────

describe("computeCadence", () => {
  it("a regular monthly series yields a ~30-day median gap", () => {
    const txns = [
      makeTxn({ datetime: "2026-01-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-02-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-03-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-04-05T12:00:00.000Z" }),
    ];
    const c = computeCadence(txns);
    expect(c.occurrences).toBe(4);
    // gaps: Jan→Feb 31, Feb→Mar 28, Mar→Apr 31 → median 31
    expect(c.medianGapDays).toBe(31);
    expect(c.minGapDays).toBe(28);
    expect(c.maxGapDays).toBe(31);
    expect(c.madGapDays).toBeLessThanOrEqual(3);
  });

  it("sorts unordered dates before measuring gaps", () => {
    const txns = [
      makeTxn({ datetime: "2026-03-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-01-05T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-02-05T12:00:00.000Z" }),
    ];
    const c = computeCadence(txns);
    expect(c.minGapDays).toBe(28);
    expect(c.maxGapDays).toBe(31);
  });

  it("reports null gaps for a single occurrence", () => {
    const c = computeCadence([makeTxn({ datetime: "2026-01-05T12:00:00.000Z" })]);
    expect(c).toEqual({
      occurrences: 1,
      medianGapDays: null,
      minGapDays: null,
      maxGapDays: null,
      madGapDays: null,
    });
  });

  it("reports zero occurrences and null gaps for empty input", () => {
    expect(computeCadence([]).occurrences).toBe(0);
    expect(computeCadence([]).medianGapDays).toBeNull();
  });

  it("captures irregularity via MAD on an erratic series", () => {
    const txns = [
      makeTxn({ datetime: "2026-01-01T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-01-03T12:00:00.000Z" }), // gap 2
      makeTxn({ datetime: "2026-03-01T12:00:00.000Z" }), // gap 57
      makeTxn({ datetime: "2026-03-02T12:00:00.000Z" }), // gap 1
    ];
    const c = computeCadence(txns);
    expect(c.minGapDays).toBe(1);
    expect(c.maxGapDays).toBe(57);
    // gaps [2,57,1] → median 2, deviations [0,55,1] → MAD 1
    expect(c.medianGapDays).toBe(2);
    expect(c.madGapDays).toBe(1);
  });

  it("keeps a one-day gap across a DST spring-forward boundary", () => {
    // US DST springs forward 2026-03-08, making that calendar day 23 hours
    // long. Consecutive days straddling it must still read as 1-day gaps —
    // locking the cadence math against any future TZ-sensitive date handling.
    const txns = [
      makeTxn({ datetime: "2026-03-07T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-03-08T12:00:00.000Z" }),
      makeTxn({ datetime: "2026-03-09T12:00:00.000Z" }),
    ];
    const c = computeCadence(txns);
    expect(c.minGapDays).toBe(1);
    expect(c.maxGapDays).toBe(1);
    expect(c.medianGapDays).toBe(1);
  });

  it("is reachable as a per-group metric", () => {
    const txns = [
      makeTxn({ merchant: "Netflix", datetime: "2026-01-05T12:00:00.000Z" }),
      makeTxn({ merchant: "Netflix", datetime: "2026-02-05T12:00:00.000Z" }),
      makeTxn({ merchant: "Spotify", datetime: "2026-01-10T12:00:00.000Z" }),
    ];
    const groups = groupTransactions(
      txns,
      { groupBy: ["merchant"], metrics: ["cadence"] },
      ctx,
    );
    expect(groups.find((g) => g.key[0].label === "Netflix")?.cadence?.medianGapDays).toBe(31);
    expect(groups.find((g) => g.key[0].label === "Spotify")?.cadence?.occurrences).toBe(1);
  });
});

// ── sorting + limit ─────────────────────────────────────────────────────

describe("groupTransactions — sort + limit", () => {
  const txns = [
    makeTxn({ categoryId: "cat-groc", amount: -1000 }),
    makeTxn({ categoryId: "cat-groc", amount: -1000 }),
    makeTxn({ categoryId: "cat-dine", amount: -500 }),
    makeTxn({ categoryId: "", amount: -100 }),
  ];

  it("sorts groups by a metric descending by default", () => {
    const groups = groupTransactions(
      txns,
      { groupBy: ["category"], metrics: ["count"], sortByMetric: "count" },
      ctx,
    );
    expect(groups.map((g) => g.count)).toEqual([2, 1, 1]);
  });

  it("sorts ascending when asked", () => {
    const groups = groupTransactions(
      txns,
      { groupBy: ["category"], metrics: ["sum"], sortByMetric: "sum", sortDir: "asc" },
      ctx,
    );
    // most-negative sum first
    expect(groups[0].sum).toBe(-2000);
  });

  it("caps to the top-N groups after sorting", () => {
    const groups = groupTransactions(
      txns,
      { groupBy: ["category"], metrics: ["count"], sortByMetric: "count", limit: 1 },
      ctx,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key[0].label).toBe("Groceries");
  });

  // The handler casts a free model string into sortByMetric, so a metric the
  // group didn't compute — or `cadence`, whose value is an object — can reach
  // sortValue at runtime. It must coerce to a stable no-op, not NaN-shuffle.
  it("leaves group order stable when sortByMetric references an unrequested metric", () => {
    const insertion = (opts: Parameters<typeof groupTransactions>[1]) =>
      groupTransactions(txns, opts, ctx).map((g) => g.key[0].label);
    const baseline = insertion({ groupBy: ["category"], metrics: ["count"] });
    const sortedByMissing = insertion({
      groupBy: ["category"],
      metrics: ["count"],
      sortByMetric: "sum" as never, // requested only count, not sum
    });
    expect(sortedByMissing).toEqual(baseline);
  });

  it("leaves group order stable when sortByMetric is 'cadence' (object value)", () => {
    const insertion = (opts: Parameters<typeof groupTransactions>[1]) =>
      groupTransactions(txns, opts, ctx).map((g) => g.key[0].label);
    const baseline = insertion({ groupBy: ["category"], metrics: ["cadence"] });
    const sortedByCadence = insertion({
      groupBy: ["category"],
      metrics: ["cadence"],
      sortByMetric: "cadence" as never,
    });
    expect(sortedByCadence).toEqual(baseline);
  });
});

// ── edge cases ──────────────────────────────────────────────────────────

describe("groupTransactions — edge cases", () => {
  it("returns an empty array for empty input", () => {
    expect(groupTransactions([], { groupBy: ["category"], metrics: ["sum"] }, ctx)).toEqual([]);
  });

  it("a single-element group produces well-formed metrics and cadence", () => {
    const groups = groupTransactions(
      [makeTxn({ amount: -750, merchant: "Solo" })],
      { groupBy: ["merchant"], metrics: ["count", "sum", "median", "cadence"] },
      ctx,
    );
    expect(groups[0].count).toBe(1);
    expect(groups[0].sum).toBe(-750);
    expect(groups[0].median).toBe(-750);
    expect(groups[0].cadence?.occurrences).toBe(1);
    expect(groups[0].cadence?.medianGapDays).toBeNull();
  });
});
