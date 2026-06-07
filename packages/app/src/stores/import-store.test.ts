import { describe, it, expect, beforeEach } from "vitest";
import type { ImportEvent, TerminalLogEntry } from "@capybudget/intelligence";
import { reduce, useImportStore } from "@/stores/import-store";

const IDLE = {
  phase: "idle" as const,
  status: "",
  log: [] as TerminalLogEntry[],
  batchProgress: null,
  grounded: false,
  error: null,
  running: false,
  rowsVersion: 0,
};

function logEntry(message: string, level: TerminalLogEntry["level"] = "info"): TerminalLogEntry {
  return { ts: 1_700_000_000_000, level, phase: "reading", message };
}

describe("import-store reduce", () => {
  it("advances phase and clears running on terminal phases", () => {
    expect(reduce(IDLE, { type: "phase", phase: "history" })).toEqual({
      phase: "history",
      running: true,
    });
    expect(reduce(IDLE, { type: "phase", phase: "done" })).toEqual({
      phase: "done",
      running: false,
    });
    expect(reduce(IDLE, { type: "phase", phase: "error" })).toEqual({
      phase: "error",
      running: false,
    });
  });

  it("replaces the status line", () => {
    const next = reduce({ ...IDLE, status: "old" }, { type: "status", phase: "reading", message: "new" });
    expect(next.status).toBe("new");
  });

  it("appends log entries oldest-first", () => {
    const a = logEntry("first");
    const b = logEntry("second");
    const afterA = { ...IDLE, ...reduce(IDLE, { type: "log", entry: a }) };
    const afterB = reduce(afterA, { type: "log", entry: b });
    expect(afterB.log).toEqual([a, b]);
  });

  it("flags grounding and records batch progress", () => {
    const grounding: Extract<ImportEvent, { type: "grounding" }> = {
      type: "grounding",
      stats: { total: 77, resolved: 47, duplicates: 4 },
      message: "47 of 77 resolved from your history · 4 duplicates",
    };
    // The store only keeps a boolean — the payoff numbers reach the user via
    // the log line, so it doesn't double-store the typed stats.
    expect(reduce(IDLE, grounding).grounded).toBe(true);

    const batch = reduce(IDLE, { type: "batch-progress", progress: { done: 12, total: 30 } });
    expect(batch.batchProgress).toEqual({ done: 12, total: 30 });
  });

  it("bumps rowsVersion on rows-changed without touching other state", () => {
    const next = reduce({ ...IDLE, rowsVersion: 3 }, { type: "rows-changed" });
    expect(next).toEqual({ rowsVersion: 4 });
  });

  it("captures recoverable errors and stops running", () => {
    const next = reduce(
      { ...IDLE, running: true },
      { type: "error", reason: "no_data", message: "No transaction data found", recoverable: true },
    );
    expect(next.error).toEqual({
      reason: "no_data",
      message: "No transaction data found",
      recoverable: true,
    });
    expect(next.running).toBe(false);
  });

  it("clears running and status on done", () => {
    const next = reduce({ ...IDLE, running: true, status: "Categorizing 30 of 30…" }, { type: "done" });
    expect(next).toEqual({ running: false, status: "" });
  });
});

describe("import-store actions", () => {
  beforeEach(() => {
    useImportStore.setState({ ...IDLE, hasImportData: false });
  });

  it("beginRun('start') clears everything for a fresh reading run, reload counter included", () => {
    useImportStore.setState({
      rowsVersion: 5,
      log: [logEntry("stale")],
      grounded: true,
    });
    useImportStore.getState().beginRun("start");
    const s = useImportStore.getState();
    expect(s.phase).toBe("reading");
    expect(s.running).toBe(true);
    expect(s.log).toEqual([]);
    expect(s.grounded).toBe(false);
    expect(s.rowsVersion).toBe(0);
  });

  it("beginRun('enrich') keeps the log + grounding + reload counter, re-enters categorizing", () => {
    const entry = logEntry("47 of 77 resolved");
    useImportStore.setState({
      log: [entry],
      grounded: true,
      phase: "done",
      rowsVersion: 6,
    });
    useImportStore.getState().beginRun("enrich");
    const s = useImportStore.getState();
    expect(s.phase).toBe("categorizing");
    expect(s.running).toBe(true);
    expect(s.log).toEqual([entry]);
    expect(s.grounded).toBe(true);
    expect(s.rowsVersion).toBe(6);
  });

  it("apply folds an event through the store", () => {
    useImportStore.getState().apply({ type: "batch-progress", progress: { done: 1, total: 4 } });
    expect(useImportStore.getState().batchProgress).toEqual({ done: 1, total: 4 });
  });

  it("reset returns fully to idle, reload counter zeroed (no stale run carries over)", () => {
    useImportStore.setState({ phase: "categorizing", running: true, rowsVersion: 9, status: "busy" });
    useImportStore.getState().reset();
    const s = useImportStore.getState();
    expect(s.phase).toBe("idle");
    expect(s.running).toBe(false);
    expect(s.status).toBe("");
    expect(s.rowsVersion).toBe(0);
  });

  it("setHasImportData toggles the sidebar flag", () => {
    useImportStore.getState().setHasImportData(true);
    expect(useImportStore.getState().hasImportData).toBe(true);
  });
});
