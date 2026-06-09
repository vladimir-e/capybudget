import { describe, it, expect } from "vitest";
import { makeImportTransaction } from "@capybudget/core/test-factories";
import {
  PROGRESS_SEGMENTS,
  activeIndex,
  meterView,
  resumeMeter,
  segmentState,
} from "./import-progress-utils";

describe("activeIndex", () => {
  it("maps each pipeline phase to its segment index", () => {
    expect(activeIndex("reading")).toBe(0);
    expect(activeIndex("normalizing")).toBe(1);
    expect(activeIndex("history")).toBe(2);
    expect(activeIndex("categorizing")).toBe(3);
  });

  it("treats done as past the last segment and idle/error as before the bar", () => {
    expect(activeIndex("done")).toBe(PROGRESS_SEGMENTS.length);
    expect(activeIndex("idle")).toBe(-1);
    expect(activeIndex("error")).toBe(-1);
  });
});

describe("segmentState", () => {
  it("marks earlier segments done, the current active, later pending", () => {
    // Active phase = History (index 2).
    expect(segmentState(0, "history")).toBe("done");
    expect(segmentState(1, "history")).toBe("done");
    expect(segmentState(2, "history")).toBe("active");
    expect(segmentState(3, "history")).toBe("pending");
  });

  it("marks every segment done on a terminal done phase", () => {
    for (let i = 0; i < PROGRESS_SEGMENTS.length; i++) {
      expect(segmentState(i, "done")).toBe("done");
    }
  });
});

describe("meterView", () => {
  it("fills a non-meter done segment fully and checks it", () => {
    expect(meterView("done", null)).toEqual({ fillPct: 100, complete: true, countLabel: null });
  });

  it("fills a non-meter active segment fully but does not check it", () => {
    expect(meterView("active", null)).toEqual({ fillPct: 100, complete: false, countLabel: null });
  });

  it("leaves pending segments empty", () => {
    expect(meterView("pending", null)).toEqual({ fillPct: 0, complete: false, countLabel: null });
  });

  it("tracks the batch meter proportionally with a live count", () => {
    expect(meterView("active", { done: 12, total: 30 })).toEqual({
      fillPct: 40,
      complete: false,
      countLabel: "12 of 30",
    });
  });

  it("checks a metered segment only when every row landed", () => {
    expect(meterView("done", { done: 30, total: 30 })).toEqual({
      fillPct: 100,
      complete: true,
      countLabel: "30 of 30",
    });
    // A run that stopped at 18/30 reads incomplete even though its phase is done.
    expect(meterView("done", { done: 18, total: 30 })).toEqual({
      fillPct: 60,
      complete: false,
      countLabel: "18 of 30",
    });
  });

  it("ignores an empty meter (total 0) and falls back to phase state", () => {
    expect(meterView("done", { done: 0, total: 0 })).toEqual({
      fillPct: 100,
      complete: true,
      countLabel: null,
    });
  });
});

describe("resumeMeter", () => {
  const done = (id: string) =>
    makeImportTransaction({ id, merchant: "X", categoryId: "cat-1", categoryConfidence: "low" });
  const pending = (id: string) => makeImportTransaction({ id, merchant: "", categoryId: "" });
  const noCtx = new Set<string>();

  it("reconstructs a partial-categorize meter from disk rows", () => {
    // A resumed import: 2 categorized, 1 still pending → 2 of 3, not complete.
    const meter = resumeMeter([done("a"), done("b"), pending("c")], noCtx);
    expect(meter).toEqual({ done: 2, total: 3 });
    // The bar then renders Categorizing partly-filled, never falsely checked,
    // even though a from-disk phase reads `done`.
    expect(meterView("done", meter)).toEqual({ fillPct: 67, complete: false, countLabel: "2 of 3" });
  });

  it("reads complete when every categorizable row landed", () => {
    expect(resumeMeter([done("a"), done("b")], noCtx)).toEqual({ done: 2, total: 2 });
  });

  it("excludes contextless transfers and duplicates from the categorizable population", () => {
    const rows = [
      done("a"),
      pending("b"),
      makeImportTransaction({ id: "c", type: "transfer" }),
      makeImportTransaction({ id: "d", duplicate: true }),
    ];
    expect(resumeMeter(rows, noCtx)).toEqual({ done: 1, total: 2 });
  });

  it("returns null when nothing is categorizable (all fast-pathed / duplicate)", () => {
    const rows = [
      makeImportTransaction({ id: "a", type: "transfer" }),
      makeImportTransaction({ id: "b", duplicate: true }),
    ];
    expect(resumeMeter(rows, noCtx)).toBeNull();
  });

  it("is not falsely complete when only a context-bearing transfer remains", () => {
    // Every category row landed; one transfer carries context but no counterpart.
    const rows = [
      done("a"),
      makeImportTransaction({ id: "t", type: "transfer", targetAccountId: "" }),
    ];
    const meter = resumeMeter(rows, new Set(["t"]));
    expect(meter).toEqual({ done: 1, total: 2 });
    expect(meterView("done", meter).complete).toBe(false);
  });

  it("counts a resolved context-bearing transfer as done (stable denominator)", () => {
    const rows = [
      done("a"),
      makeImportTransaction({ id: "t", type: "transfer", targetAccountId: "acc-2" }),
    ];
    expect(resumeMeter(rows, new Set(["t"]))).toEqual({ done: 2, total: 2 });
  });

  it("does not let a contextless transfer inflate the denominator", () => {
    // A transfer with no transfer-context entry can't be auto-resolved, so it
    // must not appear in the meter even though it lacks a counterpart.
    const rows = [
      done("a"),
      makeImportTransaction({ id: "t", type: "transfer", targetAccountId: "" }),
    ];
    expect(resumeMeter(rows, noCtx)).toEqual({ done: 1, total: 1 });
  });
});
