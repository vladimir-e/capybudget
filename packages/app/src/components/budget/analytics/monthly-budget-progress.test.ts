import { describe, expect, it } from "vitest";
import { effectiveTarget, progressState } from "./monthly-budget-progress";

describe("effectiveTarget", () => {
  it("prefers an explicit assigned over the implicit target", () => {
    expect(effectiveTarget(5000, 9000)).toBe(5000);
  });

  it("honors an explicit zero over the implicit target", () => {
    expect(effectiveTarget(0, 9000)).toBe(0);
  });

  it("falls back to the implicit target when assigned is null", () => {
    expect(effectiveTarget(null, 9000)).toBe(9000);
  });

  it("is null when neither target exists", () => {
    expect(effectiveTarget(null, null)).toBeNull();
  });
});

describe("progressState", () => {
  it("is 'ok' under the effective target", () => {
    expect(progressState(7900, 10000, null)).toBe("ok");
  });

  it("is 'ok' at exactly 100% of the target (the boundary is green)", () => {
    expect(progressState(10000, 10000, null)).toBe("ok");
  });

  it("is 'over' above 100% of the target", () => {
    expect(progressState(10001, 10000, null)).toBe("over");
  });

  it("treats explicit zero as a strict target — any spend is over", () => {
    expect(progressState(0, 0, null)).toBe("ok");
    expect(progressState(1, 0, null)).toBe("over");
    expect(progressState(10000, 0, null)).toBe("over");
  });

  it("falls back to the implicit target when assigned is null", () => {
    // No explicit budget; implicit target 10000 governs.
    expect(progressState(9000, null, 10000)).toBe("ok");
    expect(progressState(10000, null, 10000)).toBe("ok"); // exactly 100%
    expect(progressState(12000, null, 10000)).toBe("over");
  });

  it("lets an explicit budget override the implicit target", () => {
    // Spend is under the implicit target but over the explicit one.
    expect(progressState(6000, 5000, 10000)).toBe("over");
  });

  it("is 'untargeted' when there is no effective target", () => {
    expect(progressState(0, null, null)).toBe("untargeted");
    expect(progressState(50000, null, null)).toBe("untargeted");
  });
});
