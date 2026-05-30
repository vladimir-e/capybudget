import { describe, expect, it } from "vitest";
import type { BudgetRow } from "./monthly-budget-rows";
import {
  barGeometry,
  OVER_ZONE,
  TARGET_FRACTION,
} from "./budget-bar-geometry";

/** Build a row, defaulting the fields a given test doesn't care about.
 *  `effectiveTarget`/`isImplicit` are derived to match the production merge
 *  so fixtures can't drift from the real shape. */
function row(p: Partial<BudgetRow>): BudgetRow {
  const assigned = p.assigned ?? null;
  const implicitTarget = p.implicitTarget ?? null;
  return {
    categoryId: p.categoryId ?? "c",
    assigned,
    spent: p.spent ?? 0,
    lastMonth: p.lastMonth ?? 0,
    reference: p.reference ?? 0,
    implicitTarget,
    effectiveTarget: assigned ?? implicitTarget,
    isImplicit: assigned === null && implicitTarget !== null,
  };
}

describe("barGeometry — fill scale", () => {
  it("places spend === target exactly on the divider", () => {
    const g = barGeometry(row({ assigned: 10000, spent: 10000 }));
    expect(g.fillFraction).toBeCloseTo(TARGET_FRACTION, 10);
  });

  it("scales sub-target spend linearly into the green zone", () => {
    // Half the target → half the green-zone width.
    const g = barGeometry(row({ assigned: 10000, spent: 5000 }));
    expect(g.fillFraction).toBeCloseTo(TARGET_FRACTION / 2, 10);
  });

  it("empty spend reads as an empty fill", () => {
    expect(barGeometry(row({ assigned: 10000, spent: 0 })).fillFraction).toBe(0);
  });
});

describe("barGeometry — divider invariant", () => {
  it("puts the divider at the same fraction regardless of dollar scale", () => {
    const small = barGeometry(row({ assigned: 5000, spent: 1000 }));
    const huge = barGeometry(row({ assigned: 9_000_000, spent: 1000 }));
    expect(small.targetFraction).toBe(TARGET_FRACTION);
    expect(huge.targetFraction).toBe(TARGET_FRACTION);
    expect(small.targetFraction).toBe(huge.targetFraction);
  });

  it("uses the same divider whether the target is explicit or implicit", () => {
    const explicit = barGeometry(row({ assigned: 10000, spent: 5000 }));
    const implicit = barGeometry(row({ implicitTarget: 10000, spent: 5000 }));
    expect(explicit.targetFraction).toBe(TARGET_FRACTION);
    expect(implicit.targetFraction).toBe(TARGET_FRACTION);
  });
});

describe("barGeometry — overshoot compression", () => {
  it("pushes overspend past the divider but never past the track", () => {
    const g = barGeometry(row({ assigned: 10000, spent: 100000 })); // 10×
    expect(g.fillFraction).toBeGreaterThan(TARGET_FRACTION);
    expect(g.fillFraction).toBeLessThanOrEqual(1);
    expect(g.state).toBe("over");
  });

  it("keeps even an extreme overspend inside the over-zone", () => {
    const g = barGeometry(row({ assigned: 1000, spent: 100_000_000 })); // 100000×
    // The fill must not exceed the right edge of the bar.
    expect(g.fillFraction).toBeLessThanOrEqual(TARGET_FRACTION + OVER_ZONE);
  });

  it("compresses monotonically — more overspend never moves the fill left", () => {
    const f2 = barGeometry(row({ assigned: 10000, spent: 20000 })).fillFraction;
    const f4 = barGeometry(row({ assigned: 10000, spent: 40000 })).fillFraction;
    const f10 = barGeometry(row({ assigned: 10000, spent: 100000 })).fillFraction;
    expect(f4).toBeGreaterThan(f2);
    expect(f10).toBeGreaterThanOrEqual(f4);
  });
});

describe("barGeometry — pins", () => {
  it("places the higher historical pin on the divider when the target is implicit", () => {
    // implicitTarget = max(lastMonth, reference) = 11000, so the avg pin *is*
    // the target and must coincide with the divider; the lower pin sits inside
    // the green zone.
    const g = barGeometry(
      row({ implicitTarget: 11000, lastMonth: 9000, reference: 11000, spent: 6000 }),
    );
    const avg = g.pins.find((p) => p.kind === "reference")!;
    const last = g.pins.find((p) => p.kind === "lastMonth")!;
    expect(avg.fraction).toBeCloseTo(TARGET_FRACTION, 10);
    expect(last.fraction).toBeLessThan(TARGET_FRACTION);
    expect(last.fraction).toBeGreaterThan(0);
  });

  it("lets historical pins fall past the divider when the budget is explicit and below them", () => {
    // User budgeted 5000 but historically spends ~9–10k — the pins land in the
    // red zone, which is the intended "your budget is below reality" insight.
    const g = barGeometry(
      row({ assigned: 5000, lastMonth: 9000, reference: 10000, spent: 4000 }),
    );
    for (const p of g.pins) expect(p.fraction).toBeGreaterThan(TARGET_FRACTION);
    expect(g.pins.map((p) => p.kind).sort()).toEqual(["lastMonth", "reference"]);
  });

  it("orders pins low→high by position", () => {
    const g = barGeometry(
      row({ implicitTarget: 9000, lastMonth: 9000, reference: 4000, spent: 1000 }),
    );
    expect(g.pins[0].fraction).toBeLessThanOrEqual(g.pins[1].fraction);
  });

  it("omits a historical pin whose value is zero", () => {
    const g = barGeometry(
      row({ implicitTarget: 9000, lastMonth: 9000, reference: 0, spent: 1000 }),
    );
    expect(g.pins).toHaveLength(1);
    expect(g.pins[0].kind).toBe("lastMonth");
  });
});

describe("barGeometry — untargeted", () => {
  it("renders no divider and no pins, just a presence fill", () => {
    const g = barGeometry(row({ spent: 4000 })); // no assigned, no history
    expect(g.state).toBe("untargeted");
    expect(g.targetFraction).toBeNull();
    expect(g.pins).toEqual([]);
    expect(g.fillFraction).toBe(1);
  });

  it("is empty and calm when there's neither target nor spend", () => {
    const g = barGeometry(row({ spent: 0 }));
    expect(g.state).toBe("untargeted");
    expect(g.fillFraction).toBe(0);
    expect(g.targetFraction).toBeNull();
  });
});

describe("barGeometry — explicit zero target", () => {
  it("pins the divider to the left edge and fills the red zone on any spend", () => {
    const g = barGeometry(row({ assigned: 0, spent: 500 }));
    expect(g.state).toBe("over");
    expect(g.targetFraction).toBe(0);
    expect(g.fillFraction).toBeGreaterThan(TARGET_FRACTION);
    expect(g.fillFraction).toBeLessThanOrEqual(1);
    expect(g.pins).toEqual([]);
  });

  it("stays empty and non-red at zero target with zero spend", () => {
    const g = barGeometry(row({ assigned: 0, spent: 0 }));
    expect(g.state).toBe("ok");
    expect(g.fillFraction).toBe(0);
  });
});

describe("barGeometry — implicit flag passthrough", () => {
  it("marks an implicit-target row", () => {
    expect(barGeometry(row({ implicitTarget: 9000, spent: 1 })).isImplicit).toBe(true);
  });
  it("does not mark an explicit-target row", () => {
    expect(barGeometry(row({ assigned: 9000, spent: 1 })).isImplicit).toBe(false);
  });
});
