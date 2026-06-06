import { describe, it, expect } from "vitest";
import { segmentStates, PROGRESS_SEGMENTS } from "./import-progress";

describe("segmentStates", () => {
  it("marks the active phase's segment active, earlier complete, later pending", () => {
    const states = segmentStates("dedup");
    expect(states.normalize).toBe("complete");
    expect(states.accounts).toBe("complete");
    expect(states.dedup).toBe("active");
    expect(states.enrich).toBe("pending");
  });

  it("the first phase has only its own segment active", () => {
    const states = segmentStates("normalizing");
    expect(states.normalize).toBe("active");
    expect(states.accounts).toBe("pending");
    expect(states.dedup).toBe("pending");
    expect(states.enrich).toBe("pending");
  });

  it("idle leaves every segment pending", () => {
    const states = segmentStates("idle");
    for (const segment of PROGRESS_SEGMENTS) {
      expect(states[segment]).toBe("pending");
    }
  });

  it("review (done) marks every work segment complete — incl. the halt case", () => {
    // The all-duplicate halt short-circuits dedup → review, skipping enrich.
    // The bar must still land fully done, not leave enrich pending forever.
    const states = segmentStates("review");
    for (const segment of PROGRESS_SEGMENTS) {
      expect(states[segment]).toBe("complete");
    }
  });

  it("enriching completes the three prior work segments", () => {
    const states = segmentStates("enriching");
    expect(states.normalize).toBe("complete");
    expect(states.accounts).toBe("complete");
    expect(states.dedup).toBe("complete");
    expect(states.enrich).toBe("active");
  });
});
