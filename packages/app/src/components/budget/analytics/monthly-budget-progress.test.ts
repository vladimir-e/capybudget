import { describe, expect, it } from "vitest";
import { progressState } from "./monthly-budget-progress";

describe("progressState", () => {
  it("returns null for untracked categories", () => {
    expect(progressState(0, null)).toBe(null);
    expect(progressState(5000, null)).toBe(null);
  });

  it("returns 'ok' for tracked-zero with no spend", () => {
    expect(progressState(0, 0)).toBe("ok");
  });

  it("returns 'over' for tracked-zero with any spend", () => {
    expect(progressState(1, 0)).toBe("over");
    expect(progressState(10000, 0)).toBe("over");
  });

  it("returns 'ok' when ratio is below 0.8", () => {
    // 79 / 100 = 0.79 → ok
    expect(progressState(79, 100)).toBe("ok");
  });

  it("returns 'warn' at the 0.8 boundary", () => {
    // 80 / 100 = 0.8 → warn
    expect(progressState(80, 100)).toBe("warn");
  });

  it("returns 'warn' at the 1.0 boundary (not over)", () => {
    // 100 / 100 = 1.0 → still warn, not over
    expect(progressState(100, 100)).toBe("warn");
  });

  it("returns 'over' when ratio exceeds 1", () => {
    // 101 / 100 = 1.01 → over
    expect(progressState(101, 100)).toBe("over");
  });
});
