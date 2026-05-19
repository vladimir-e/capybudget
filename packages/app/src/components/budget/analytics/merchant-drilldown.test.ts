import { describe, it, expect } from "vitest";
import {
  matchesTarget,
  targetForRow,
} from "./merchant-drilldown";

describe("targetForRow", () => {
  it("routes the synthetic empty bucket to kind 'unknown'", () => {
    expect(targetForRow({ merchant: "Unknown", isUnknown: true })).toEqual({
      kind: "unknown",
    });
  });

  it("routes a real merchant literally named 'Unknown' to kind 'merchant'", () => {
    expect(targetForRow({ merchant: "Unknown", isUnknown: false })).toEqual({
      kind: "merchant",
      value: "Unknown",
    });
  });

  it("preserves the display casing for named merchants", () => {
    expect(targetForRow({ merchant: "Whole Foods", isUnknown: false })).toEqual({
      kind: "merchant",
      value: "Whole Foods",
    });
  });
});

describe("matchesTarget", () => {
  it("matches the empty bucket against empty / whitespace-only merchants only", () => {
    const target = { kind: "unknown" } as const;
    expect(matchesTarget("", target)).toBe(true);
    expect(matchesTarget("   ", target)).toBe(true);
    expect(matchesTarget("Unknown", target)).toBe(false); // legit "Unknown" must NOT match
    expect(matchesTarget("Whole Foods", target)).toBe(false);
  });

  it("matches named merchants case-insensitively, ignoring surrounding whitespace", () => {
    const target = { kind: "merchant" as const, value: "Whole Foods" };
    expect(matchesTarget("Whole Foods", target)).toBe(true);
    expect(matchesTarget("whole foods", target)).toBe(true);
    expect(matchesTarget("  WHOLE FOODS  ", target)).toBe(true);
    expect(matchesTarget("Whole Food", target)).toBe(false);
    expect(matchesTarget("", target)).toBe(false);
  });

  it("does not collide: a real 'Unknown' merchant doesn't match the empty bucket and vice versa", () => {
    const empty = { kind: "unknown" } as const;
    const realUnknown = { kind: "merchant" as const, value: "Unknown" };

    // A transaction whose merchant IS the empty string belongs only to the empty bucket
    expect(matchesTarget("", empty)).toBe(true);
    expect(matchesTarget("", realUnknown)).toBe(false);

    // A transaction whose merchant is literally "Unknown" belongs only to the named-merchant target
    expect(matchesTarget("Unknown", empty)).toBe(false);
    expect(matchesTarget("Unknown", realUnknown)).toBe(true);
  });
});
