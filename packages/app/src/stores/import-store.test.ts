import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";
import {
  ACCOUNTS_INSTRUCTION,
  DEDUP_INSTRUCTION,
  ENRICH_INSTRUCTION,
  IMPORT_PIPELINE,
} from "@capybudget/intelligence";

// ── Mocks ──────────────────────────────────────────────────────────

const mockRunTool = vi.fn<
  (
    name: string,
    input: Record<string, unknown>,
    ctx: unknown,
  ) => Promise<string>
>();

const mockMarkImportEnriched = vi.fn<
  (fileAdapter: unknown, budgetPath: string) => Promise<void>
>();

const mockReadStagingDuplicateTally = vi.fn<
  (
    fileAdapter: unknown,
    budgetPath: string,
  ) => Promise<{ total: number; duplicateCount: number }>
>();

// The store reads IMPORT_PIPELINE at call time. The mock returns a mutable deep
// clone (the real one is frozen) so the multi-tool-cancel test can extend the
// enrich pre-step in place; the imported `IMPORT_PIPELINE` IS that array, and
// beforeEach restores the enrich step's default tool.
interface MutableStep {
  phase: string;
  preStepTools: string[];
  instruction: string | null;
}

vi.mock("@capybudget/intelligence", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const realPipeline = original.IMPORT_PIPELINE as readonly MutableStep[];
  const pipeline: MutableStep[] = realPipeline.map((s) => ({
    phase: s.phase,
    preStepTools: [...s.preStepTools],
    instruction: s.instruction,
  }));
  return {
    ...original,
    IMPORT_PIPELINE: pipeline,
    runTool: (name: string, input: Record<string, unknown>, ctx: unknown) => {
      callOrder.push(`runTool:${name}`);
      return mockRunTool(name, input, ctx);
    },
    markImportEnriched: (fileAdapter: unknown, budgetPath: string) => {
      callOrder.push("markImportEnriched");
      return mockMarkImportEnriched(fileAdapter, budgetPath);
    },
    readStagingDuplicateTally: (fileAdapter: unknown, budgetPath: string) => {
      callOrder.push("readStagingDuplicateTally");
      return mockReadStagingDuplicateTally(fileAdapter, budgetPath);
    },
  };
});

const stepFor = (phase: string) =>
  (IMPORT_PIPELINE as unknown as MutableStep[]).find((s) => s.phase === phase)!;
const enrichStep = () => stepFor("enriching");
const accountsStep = () => stepFor("accounts");
const dedupStep = () => stepFor("dedup");

// Each created session is a tracked instance: its send() calls (with the
// emitted onEvent handler) let tests drive the stream and assert that the
// enrich turn injects into the SAME session, not a new one.
interface MockSession {
  id: number;
  sends: unknown[];
  onEvent: (event: { type: string; blocks?: unknown[]; message?: string }) => void;
  emitContent: (text: string) => void;
  emitStatus: (text: string) => void;
  emitToolActivity: (tool: string) => void;
  emitError: (message: string) => void;
  emitDone: () => void;
}

const sessions: MockSession[] = [];
const sessionKill = vi.fn<() => Promise<void>>();
const sessionSend = vi.fn<(message: unknown) => Promise<void>>();
const callOrder: string[] = [];
let sessionCounter = 0;

vi.mock("@/services/create-session", () => ({
  createSession: vi.fn(
    (opts: { onEvent: MockSession["onEvent"] }) => {
      const id = ++sessionCounter;
      // Real adapters emit the *cumulative* block array each tick and reset it
      // per turn (each `send`). The mock mirrors that: emit helpers append to a
      // per-turn buffer and forward the whole array.
      let turnBlocks: unknown[] = [];
      const emit = (block: unknown) => {
        turnBlocks.push(block);
        session.onEvent({ type: "content", blocks: [...turnBlocks] });
      };
      const session: MockSession = {
        id,
        sends: [],
        onEvent: opts.onEvent,
        emitContent(text: string) {
          emit({ type: "text", content: text });
        },
        emitStatus(text: string) {
          emit({ type: "status", text });
        },
        emitToolActivity(tool: string) {
          emit({ type: "tool-activity", tool });
        },
        emitError(message: string) {
          this.onEvent({ type: "error", message });
        },
        emitDone() {
          turnBlocks = []; // a new phase-turn re-sends only its own blocks
          this.onEvent({ type: "done" });
        },
      };
      sessions.push(session);
      return {
        send: (msg: unknown) => {
          callOrder.push("send");
          session.sends.push(msg);
          turnBlocks = [];
          return sessionSend(msg);
        },
        kill: () => sessionKill(),
        stop: vi.fn(),
        restart: vi.fn(),
        isAlive: true,
      };
    },
  ),
}));

import { useImportStore } from "@/stores/import-store";

// Flush the microtask queue so chained `.then()` / `await` settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ── Tests ──────────────────────────────────────────────────────────

describe("import-store", () => {
  beforeEach(() => {
    useImportStore.setState({
      hasImportData: false,
      phase: "idle",
      runSession: null,
      runMessages: [],
      statusText: "",
      statusLog: [],
      runOutcome: null,
      reenrichSession: null,
      isEnriching: false,
      enrichStatusText: "",
    });
    mockRunTool.mockReset();
    mockRunTool.mockResolvedValue("ok");
    mockMarkImportEnriched.mockReset();
    mockMarkImportEnriched.mockResolvedValue();
    mockReadStagingDuplicateTally.mockReset();
    // Default: a partial import (some new rows) — the run advances to enrich,
    // matching the happy-path tests. The halt tests override this per-case.
    mockReadStagingDuplicateTally.mockResolvedValue({
      total: 10,
      duplicateCount: 3,
    });
    sessionSend.mockReset();
    sessionSend.mockResolvedValue();
    sessionKill.mockReset();
    sessionKill.mockResolvedValue();
    callOrder.length = 0;
    sessions.length = 0;
    sessionCounter = 0;
    // Restore the phase pre-steps to their single-tool defaults (a test may
    // extend one in place to exercise multi-tool pre-steps).
    enrichStep().preStepTools.length = 0;
    enrichStep().preStepTools.push("auto_enrich");
    accountsStep().preStepTools.length = 0;
    accountsStep().preStepTools.push("apply_account_aliases");
    dedupStep().preStepTools.length = 0;
    dedupStep().preStepTools.push("auto_mark_duplicates");
  });

  it("starts with hasImportData false", () => {
    expect(useImportStore.getState().hasImportData).toBe(false);
  });

  it("setHasImportData updates the flag", () => {
    useImportStore.getState().setHasImportData(true);
    expect(useImportStore.getState().hasImportData).toBe(true);

    useImportStore.getState().setHasImportData(false);
    expect(useImportStore.getState().hasImportData).toBe(false);
  });

  // ── Pipeline shape (the spine's extensibility contract) ───────────

  describe("IMPORT_PIPELINE", () => {
    it("starts at normalize and ends at enrich", () => {
      expect(IMPORT_PIPELINE[0].phase).toBe("normalizing");
      expect(IMPORT_PIPELINE[IMPORT_PIPELINE.length - 1].phase).toBe("enriching");
    });

    it("runs normalize → accounts → dedup → enrich in order", () => {
      expect(IMPORT_PIPELINE.map((s) => s.phase)).toEqual([
        "normalizing",
        "accounts",
        "dedup",
        "enriching",
      ]);
    });

    it("kickoff phase carries no injected instruction", () => {
      expect(IMPORT_PIPELINE[0].instruction).toBeNull();
    });

    it("accounts phase injects the accounts instruction and pre-runs apply_account_aliases", () => {
      const accounts = IMPORT_PIPELINE.find((s) => s.phase === "accounts")!;
      expect(accounts.instruction).toBe(ACCOUNTS_INSTRUCTION);
      expect(accounts.preStepTools).toContain("apply_account_aliases");
    });

    it("dedup phase injects the dedup instruction and pre-runs auto_mark_duplicates", () => {
      const dedup = IMPORT_PIPELINE.find((s) => s.phase === "dedup")!;
      expect(dedup.instruction).toBe(DEDUP_INSTRUCTION);
      expect(dedup.preStepTools).toContain("auto_mark_duplicates");
    });

    it("orders accounts before dedup (dedup rules key off the resolved account)", () => {
      const phases = IMPORT_PIPELINE.map((s) => s.phase);
      expect(phases.indexOf("accounts")).toBeLessThan(phases.indexOf("dedup"));
    });

    it("enrich phase injects the enrich instruction and pre-runs auto_enrich", () => {
      const enrich = IMPORT_PIPELINE.find((s) => s.phase === "enriching")!;
      expect(enrich.instruction).toBe(ENRICH_INSTRUCTION);
      expect(enrich.preStepTools).toContain("auto_enrich");
    });
  });

  // ── The orchestrated run (the spine) ──────────────────────────────

  describe("startRun", () => {
    const startRun = () => {
      const repo = {} as BudgetRepository;
      const fileAdapter = {} as FileAdapter;
      useImportStore.getState().startRun({
        budgetPath: "/budget",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
        initialMessage: "normalize these files",
        sourceFilenames: ["statement.csv"],
        repo,
        fileAdapter,
      });
      return { repo, fileAdapter };
    };

    it("creates exactly one session for the whole run", async () => {
      startRun();
      // Walk normalize → accounts → dedup → enrich → done; no phase spawns a
      // new session.
      sessions[0].emitDone(); // normalize done → advance to accounts
      await flush();
      sessions[0].emitDone(); // accounts done → advance to dedup
      await flush();
      sessions[0].emitDone(); // dedup done → advance to enrich
      await flush();
      sessions[0].emitDone(); // enrich done → review
      await flush();

      expect(sessions).toHaveLength(1);
    });

    it("starts in the normalizing phase and sends the kickoff message", () => {
      startRun();
      expect(useImportStore.getState().phase).toBe("normalizing");
      expect(callOrder).toContain("send");
      expect(sessions[0].sends[0]).toBe("normalize these files");
    });

    it("transitions normalize → accounts → dedup → enriching → review in order", async () => {
      startRun();
      const seen: string[] = [useImportStore.getState().phase];

      for (let i = 0; i < 4; i++) {
        sessions[0].emitDone();
        await flush();
        seen.push(useImportStore.getState().phase);
      }

      expect(seen).toEqual([
        "normalizing",
        "accounts",
        "dedup",
        "enriching",
        "review",
      ]);
    });

    it("injects accounts, dedup, then enrich instructions as new turns into the SAME session", async () => {
      startRun();
      sessions[0].emitDone(); // normalize done → accounts
      await flush();
      sessions[0].emitDone(); // accounts done → dedup
      await flush();
      sessions[0].emitDone(); // dedup done → enrich
      await flush();

      // All phase instructions injected into the one session — sequential
      // injection, not fresh sessions.
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sends).toEqual([
        "normalize these files",
        ACCOUNTS_INSTRUCTION,
        DEDUP_INSTRUCTION,
        ENRICH_INSTRUCTION,
      ]);
    });

    it("runs the apply_account_aliases pre-step before injecting the accounts turn", async () => {
      const { repo, fileAdapter } = startRun();
      callOrder.length = 0; // ignore the kickoff send

      sessions[0].emitDone(); // normalize done → accounts pre-step then inject
      await flush();

      expect(mockRunTool).toHaveBeenCalledWith(
        "apply_account_aliases",
        {},
        expect.objectContaining({ repo, fileAdapter, budgetPath: "/budget" }),
      );
      const aliasIdx = callOrder.indexOf("runTool:apply_account_aliases");
      const sendIdx = callOrder.indexOf("send");
      expect(aliasIdx).toBeGreaterThanOrEqual(0);
      expect(sendIdx).toBeGreaterThan(aliasIdx);
    });

    it("runs the auto_mark_duplicates pre-step before injecting the dedup turn", async () => {
      const { repo, fileAdapter } = startRun();

      sessions[0].emitDone(); // normalize done → accounts
      await flush();
      callOrder.length = 0; // ignore prior sends/pre-steps
      sessions[0].emitDone(); // accounts done → dedup pre-step then inject
      await flush();

      expect(mockRunTool).toHaveBeenCalledWith(
        "auto_mark_duplicates",
        {},
        expect.objectContaining({ repo, fileAdapter, budgetPath: "/budget" }),
      );
      const autoMarkIdx = callOrder.indexOf("runTool:auto_mark_duplicates");
      const sendIdx = callOrder.indexOf("send");
      expect(autoMarkIdx).toBeGreaterThanOrEqual(0);
      expect(sendIdx).toBeGreaterThan(autoMarkIdx);
    });

    it("runs the auto_enrich pre-step before injecting the enrich turn", async () => {
      const { repo, fileAdapter } = startRun();

      sessions[0].emitDone(); // normalize done → accounts
      await flush();
      sessions[0].emitDone(); // accounts done → dedup
      await flush();
      callOrder.length = 0; // ignore prior sends/pre-steps
      sessions[0].emitDone(); // dedup done → enrich pre-step then inject
      await flush();

      expect(mockRunTool).toHaveBeenCalledWith(
        "auto_enrich",
        {},
        expect.objectContaining({ repo, fileAdapter, budgetPath: "/budget" }),
      );
      // Ordering: auto_enrich must complete before the enrich turn is sent.
      const autoEnrichIdx = callOrder.indexOf("runTool:auto_enrich");
      const sendIdx = callOrder.indexOf("send");
      expect(autoEnrichIdx).toBeGreaterThanOrEqual(0);
      expect(sendIdx).toBeGreaterThan(autoEnrichIdx);
    });

    // Drive every phase to review: one `done` per pipeline step (normalize's
    // done advances to step 1, …, the last step's done lands on review), so
    // this self-extends as phases are inserted.
    const driveToReview = async () => {
      for (let i = 0; i < IMPORT_PIPELINE.length; i++) {
        sessions[0].emitDone();
        await flush();
      }
    };

    it("lands on review and marks import data present when the run completes", async () => {
      startRun();
      await driveToReview();

      expect(useImportStore.getState().phase).toBe("review");
      expect(useImportStore.getState().hasImportData).toBe(true);
      // A partial import (the default tally: 10 total, 3 dup) lands on the
      // `ready` outcome with the merge-ready vs dimmed split computed from the
      // staging tally.
      expect(useImportStore.getState().runOutcome).toEqual({
        kind: "ready",
        counts: { ready: 7, duplicates: 3 },
      });
    });

    it("persists the enriched flag itself on run-complete (no component callback)", async () => {
      const { fileAdapter } = startRun();
      await driveToReview();

      // The store — not a mounted component — persisted enriched to state.json.
      expect(mockMarkImportEnriched).toHaveBeenCalledTimes(1);
      expect(mockMarkImportEnriched).toHaveBeenCalledWith(fileAdapter, "/budget");
    });

    it("kills the run session and nulls it on completion", async () => {
      startRun();
      await driveToReview();

      expect(sessionKill).toHaveBeenCalled();
      expect(useImportStore.getState().runSession).toBeNull();
    });

    it("cancel resets to idle and kills the session", async () => {
      startRun();
      sessions[0].emitDone(); // mid-run (now accounts)
      await flush();
      expect(useImportStore.getState().phase).toBe("accounts");

      useImportStore.getState().cancelRun();

      expect(useImportStore.getState().phase).toBe("idle");
      expect(useImportStore.getState().runSession).toBeNull();
      expect(useImportStore.getState().runMessages).toEqual([]);
      expect(sessionKill).toHaveBeenCalled();
    });

    it("does not inject the next turn if cancelled during the pre-step", async () => {
      // Make the accounts pre-step (apply_account_aliases) hang until we
      // cancel, simulating a mid-pre-step cancel.
      let resolvePreStep: (v: string) => void = () => {};
      mockRunTool.mockImplementationOnce(
        () => new Promise<string>((r) => { resolvePreStep = r; }),
      );

      startRun();
      const sendsBefore = sessions[0].sends.length;
      sessions[0].emitDone(); // normalize done → accounts pre-step starts (hangs)
      await flush();

      useImportStore.getState().cancelRun(); // user cancels during pre-step
      resolvePreStep("ok"); // pre-step finishes after cancel
      await flush();

      // The accounts turn must NOT have been injected.
      expect(sessions[0].sends.length).toBe(sendsBefore);
      expect(useImportStore.getState().phase).toBe("idle");
    });

    it("stops a multi-tool pre-step at the next tool when cancelled mid-loop", async () => {
      // Give the accounts phase multiple deterministic pre-step tools.
      accountsStep().preStepTools.length = 0;
      accountsStep().preStepTools.push("pre_a", "pre_b");

      // First tool hangs until we cancel; the second must never run.
      let resolveFirst: (v: string) => void = () => {};
      mockRunTool.mockImplementationOnce(
        () => new Promise<string>((r) => { resolveFirst = r; }),
      );

      startRun();
      sessions[0].emitDone(); // normalize done → pre-step loop starts (pre_a hangs)
      await flush();

      useImportStore.getState().cancelRun(); // cancel mid-loop
      resolveFirst("ok"); // pre_a settles after cancel
      await flush();

      const toolCalls = callOrder.filter((c) => c.startsWith("runTool:"));
      expect(toolCalls).toContain("runTool:pre_a");
      expect(toolCalls).not.toContain("runTool:pre_b");
      expect(useImportStore.getState().phase).toBe("idle");
    });
  });

  // ── Status channel: report_status drives the line + log ───────────
  // Import mode talks via `report_status` (→ `status` blocks), not prose. The
  // newest line is `statusText`; the prior line drops into `statusLog`, stamped.

  describe("status channel (report_status)", () => {
    const startRun = () => {
      useImportStore.getState().startRun({
        budgetPath: "/budget",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
        initialMessage: "normalize these files",
        sourceFilenames: ["statement.csv"],
        repo: {} as BudgetRepository,
        fileAdapter: {} as FileAdapter,
      });
    };

    it("a status block sets the active line; the log stays empty", () => {
      startRun();
      sessions[0].emitStatus("Reading your March statement…");
      expect(useImportStore.getState().statusText).toBe(
        "Reading your March statement…",
      );
      expect(useImportStore.getState().statusLog).toEqual([]);
    });

    it("a new status line pushes the prior one into the timestamped log", () => {
      startRun();
      sessions[0].emitStatus("Reading your March statement…");
      sessions[0].emitStatus("Mapping accounts…");

      const state = useImportStore.getState();
      expect(state.statusText).toBe("Mapping accounts…");
      expect(state.statusLog).toHaveLength(1);
      expect(state.statusLog[0].text).toBe("Reading your March statement…");
      expect(typeof state.statusLog[0].at).toBe("number");
    });

    it("keeps the log newest-first as more lines arrive", () => {
      startRun();
      sessions[0].emitStatus("one");
      sessions[0].emitStatus("two");
      sessions[0].emitStatus("three");

      const state = useImportStore.getState();
      expect(state.statusText).toBe("three");
      expect(state.statusLog.map((e) => e.text)).toEqual(["two", "one"]);
    });

    it("ignores a repeated consecutive line (no log spam)", () => {
      startRun();
      sessions[0].emitStatus("Categorizing…");
      sessions[0].emitStatus("Categorizing…");

      const state = useImportStore.getState();
      expect(state.statusText).toBe("Categorizing…");
      expect(state.statusLog).toEqual([]);
    });

    it("does not let assistant prose drive the status line", () => {
      startRun();
      sessions[0].emitStatus("Reading…");
      sessions[0].emitContent("Here is a paragraph of prose the model leaked.");
      // The prose lands in the message stream but never becomes the status line.
      expect(useImportStore.getState().statusText).toBe("Reading…");
    });

    it("carries the log across phases (committed on phase advance)", async () => {
      startRun();
      sessions[0].emitStatus("Reading your statement…"); // normalize turn
      sessions[0].emitDone(); // normalize → accounts (commits the normalize line)
      await flush();
      sessions[0].emitStatus("Mapping accounts…"); // accounts turn (re-sends only its own)

      const state = useImportStore.getState();
      expect(state.statusText).toBe("Mapping accounts…");
      // The normalize line survived into the log even though the accounts turn's
      // cumulative array no longer carries it.
      expect(state.statusLog.map((e) => e.text)).toEqual(["Reading your statement…"]);
    });

    it("resets the line and log on cancel", () => {
      startRun();
      sessions[0].emitStatus("one");
      sessions[0].emitStatus("two");
      useImportStore.getState().cancelRun();
      expect(useImportStore.getState().statusText).toBe("");
      expect(useImportStore.getState().statusLog).toEqual([]);
    });
  });

  // ── Run error → terminal error outcome ────────────────────────────

  describe("run error", () => {
    const startRun = () => {
      useImportStore.getState().startRun({
        budgetPath: "/budget",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
        initialMessage: "normalize these files",
        sourceFilenames: ["statement.csv"],
        repo: {} as BudgetRepository,
        fileAdapter: {} as FileAdapter,
      });
    };

    it("a mid-run error lands a terminal error outcome and tears down the session", () => {
      startRun();
      sessions[0].emitError("provider exploded");

      const state = useImportStore.getState();
      expect(state.runOutcome).toEqual({
        kind: "error",
        message: "provider exploded",
      });
      expect(state.runSession).toBeNull();
      expect(sessionKill).toHaveBeenCalled();
      // Phase stays put so the screen keeps the processing view (where the
      // error renders as a prominent result), not idle.
      expect(state.phase).toBe("normalizing");
    });

    it("a stray error after the run already landed on review is ignored", async () => {
      startRun();
      const session = sessions[0];
      session.emitDone(); // → accounts
      await flush();
      session.emitDone(); // → dedup
      await flush();
      session.emitDone(); // dedup turn ends, halt check (partial) → enrich
      await flush();
      session.emitDone(); // → review (ready)
      await flush();
      expect(useImportStore.getState().phase).toBe("review");

      // The dead session forwards a late error; failRun must bail on `review`.
      session.emitError("late stray");
      const state = useImportStore.getState();
      expect(state.runOutcome?.kind).toBe("ready");
      expect(state.phase).toBe("review");
    });
  });

  // ── Dedup halt: all-duplicate import skips enrich ─────────────────
  // The deterministic halt is the regression anchor: after the dedup turn ends,
  // the orchestrator reads the staging tally; if every row is a duplicate it
  // skips the enrich phase entirely and completes with a `nothing-to-import`
  // outcome. Pinned hard — the bug this fixes was the run always advancing.

  describe("dedup halt (all-duplicate import)", () => {
    const startRun = () => {
      const repo = {} as BudgetRepository;
      const fileAdapter = {} as FileAdapter;
      useImportStore.getState().startRun({
        budgetPath: "/budget",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
        initialMessage: "normalize these files",
        sourceFilenames: ["statement.csv"],
        repo,
        fileAdapter,
      });
      return { repo, fileAdapter };
    };

    // Walk normalize → accounts → dedup, then end the dedup turn. The halt
    // decision runs on that final `done`.
    const driveThroughDedup = async () => {
      sessions[0].emitDone(); // normalize → accounts
      await flush();
      sessions[0].emitDone(); // accounts → dedup
      await flush();
      sessions[0].emitDone(); // dedup turn ends → halt check
      await flush();
    };

    it("skips enrich and completes with a nothing-to-import outcome when every row is a duplicate", async () => {
      mockReadStagingDuplicateTally.mockResolvedValue({
        total: 23,
        duplicateCount: 23,
      });

      startRun();
      const sendsBeforeDedupDone = () => sessions[0].sends.length;

      sessions[0].emitDone(); // normalize → accounts
      await flush();
      sessions[0].emitDone(); // accounts → dedup
      await flush();
      const sendsAfterDedupInject = sendsBeforeDedupDone();
      sessions[0].emitDone(); // dedup turn ends → halt fires
      await flush();

      const state = useImportStore.getState();
      // Completed terminally without an enrich phase.
      expect(state.phase).toBe("review");
      expect(state.runOutcome).toEqual({
        kind: "nothing-to-import",
        message: "All 23 transactions are already in your budget — nothing to import.",
      });
      // No enrich instruction injected — the run never advanced past dedup.
      expect(sessions[0].sends).not.toContain(ENRICH_INSTRUCTION);
      expect(sessions[0].sends.length).toBe(sendsAfterDedupInject);
      // No enrich pre-step (auto_enrich) ran.
      expect(callOrder).not.toContain("runTool:auto_enrich");
    });

    it("checks the staging tally with the run's file adapter", async () => {
      mockReadStagingDuplicateTally.mockResolvedValue({
        total: 5,
        duplicateCount: 5,
      });
      const { fileAdapter } = startRun();
      await driveThroughDedup();

      expect(mockReadStagingDuplicateTally).toHaveBeenCalledWith(
        fileAdapter,
        "/budget",
      );
    });

    it("still persists the enriched flag and kills the session on a halt", async () => {
      mockReadStagingDuplicateTally.mockResolvedValue({
        total: 4,
        duplicateCount: 4,
      });
      const { fileAdapter } = startRun();
      await driveThroughDedup();

      expect(mockMarkImportEnriched).toHaveBeenCalledTimes(1);
      expect(mockMarkImportEnriched).toHaveBeenCalledWith(fileAdapter, "/budget");
      expect(sessionKill).toHaveBeenCalled();
      expect(useImportStore.getState().runSession).toBeNull();
    });

    it("proceeds to enrich (ready outcome) when only some rows are duplicates", async () => {
      mockReadStagingDuplicateTally.mockResolvedValue({
        total: 50,
        duplicateCount: 3,
      });

      startRun();
      await driveThroughDedup();

      // Partial import: dedup advanced to enrich, the run is still in-flight.
      expect(useImportStore.getState().phase).toBe("enriching");
      expect(sessions[0].sends).toContain(ENRICH_INSTRUCTION);
      expect(callOrder).toContain("runTool:auto_enrich");

      // Finish the enrich turn → ready outcome with the completion counts.
      sessions[0].emitDone();
      await flush();
      expect(useImportStore.getState().phase).toBe("review");
      expect(useImportStore.getState().runOutcome).toEqual({
        kind: "ready",
        counts: { ready: 47, duplicates: 3 },
      });
    });

    it("does not halt on an empty staging file (total 0)", async () => {
      mockReadStagingDuplicateTally.mockResolvedValue({
        total: 0,
        duplicateCount: 0,
      });

      startRun();
      await driveThroughDedup();

      // No rows at all is not a "nothing to import" halt — proceed to enrich.
      expect(useImportStore.getState().phase).toBe("enriching");
      expect(sessions[0].sends).toContain(ENRICH_INSTRUCTION);
    });

    it("uses singular phrasing for a single-row all-duplicate import", async () => {
      mockReadStagingDuplicateTally.mockResolvedValue({
        total: 1,
        duplicateCount: 1,
      });

      startRun();
      await driveThroughDedup();

      expect(useImportStore.getState().runOutcome).toEqual({
        kind: "nothing-to-import",
        message: "All 1 transaction is already in your budget — nothing to import.",
      });
    });
  });

  // ── Resume an interrupted run (full post-normalize pipeline) ──────

  describe("resumeRun", () => {
    const resumeRun = () => {
      const repo = {} as BudgetRepository;
      const fileAdapter = {} as FileAdapter;
      useImportStore.getState().resumeRun({
        budgetPath: "/budget",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy, resuming",
        repo,
        fileAdapter,
      });
      return { repo, fileAdapter };
    };

    it("enters at the accounts phase, never re-running normalize", async () => {
      resumeRun();
      await flush();

      // The resumed run lands directly on the first post-normalize phase.
      expect(useImportStore.getState().phase).toBe("accounts");
      // Normalize (index 0) is the kickoff phase with a null instruction —
      // a resume must NOT send a normalize turn. The first (and so far only)
      // injected turn is the accounts instruction, not a normalize kickoff.
      expect(sessions[0].sends).toEqual([ACCOUNTS_INSTRUCTION]);
    });

    it("runs the accounts pre-step before injecting the accounts turn", async () => {
      const { repo, fileAdapter } = resumeRun();
      await flush();

      expect(mockRunTool).toHaveBeenCalledWith(
        "apply_account_aliases",
        {},
        expect.objectContaining({ repo, fileAdapter, budgetPath: "/budget" }),
      );
      const aliasIdx = callOrder.indexOf("runTool:apply_account_aliases");
      const sendIdx = callOrder.indexOf("send");
      expect(aliasIdx).toBeGreaterThanOrEqual(0);
      expect(sendIdx).toBeGreaterThan(aliasIdx);
    });

    it("walks every post-normalize phase, in order, in one session", async () => {
      resumeRun();
      await flush(); // accounts pre-step + inject

      // Drive each remaining agent turn to completion until the run lands on
      // review. Asserted against the live pipeline (not a hardcoded list), so
      // when Unit 2 inserts `dedup` after accounts the resume picks it up here.
      const postNormalize = (IMPORT_PIPELINE as unknown as MutableStep[]).slice(1);
      const phasesSeen: string[] = [useImportStore.getState().phase];
      // Already drove the first phase's pre-step + inject above; complete it
      // and each subsequent phase in turn.
      for (let i = 0; i < postNormalize.length; i++) {
        sessions[0].emitDone();
        await flush();
        phasesSeen.push(useImportStore.getState().phase);
      }

      // Phases walked: every post-normalize phase, then terminal review.
      expect(phasesSeen).toEqual([
        ...postNormalize.map((s) => s.phase),
        "review",
      ]);

      // Each post-normalize phase's instruction was injected, in order, into
      // the one session — no normalize turn, no second session.
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sends).toEqual(
        postNormalize.map((s) => s.instruction).filter((i) => i !== null),
      );
    });

    // Resume enters at the first post-normalize phase (its pre-step + inject
    // run on the initial flush), so reaching review needs one `done` per
    // remaining post-normalize phase. Self-extends as phases are inserted.
    const driveResumeToReview = async () => {
      for (let i = 0; i < IMPORT_PIPELINE.length - 1; i++) {
        sessions[0].emitDone();
        await flush();
      }
    };

    it("persists the enriched flag when the resumed run completes", async () => {
      const { fileAdapter } = resumeRun();
      await flush(); // first post-normalize phase pre-step + inject
      await driveResumeToReview();

      expect(useImportStore.getState().phase).toBe("review");
      expect(mockMarkImportEnriched).toHaveBeenCalledTimes(1);
      expect(mockMarkImportEnriched).toHaveBeenCalledWith(fileAdapter, "/budget");
    });

    it("creates exactly one session (no normalize session)", async () => {
      resumeRun();
      await flush();
      await driveResumeToReview();

      expect(sessions).toHaveLength(1);
    });

    it("cancel during a resumed run resets to idle and kills the session", async () => {
      resumeRun();
      await flush();
      expect(useImportStore.getState().phase).toBe("accounts");

      useImportStore.getState().cancelRun();

      expect(useImportStore.getState().phase).toBe("idle");
      expect(useImportStore.getState().runSession).toBeNull();
      expect(sessionKill).toHaveBeenCalled();
    });
  });

  // ── Standalone re-enrich (preview's Enrich button) ────────────────

  describe("startReenrich", () => {
    const startWithRepo = () => {
      const repo = {} as BudgetRepository;
      const fileAdapter = {} as FileAdapter;
      useImportStore.getState().startReenrich({
        budgetPath: "/budget",
        budgetName: "Test",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
        repo,
        fileAdapter,
      });
      return { repo, fileAdapter };
    };

    it("pre-runs auto_enrich before sending the first user message", async () => {
      const { repo, fileAdapter } = startWithRepo();
      await flush();

      expect(mockRunTool).toHaveBeenCalledWith(
        "auto_enrich",
        {},
        expect.objectContaining({ repo, fileAdapter, budgetPath: "/budget" }),
      );

      const autoEnrichIdx = callOrder.indexOf("runTool:auto_enrich");
      const sendIdx = callOrder.indexOf("send");
      expect(autoEnrichIdx).toBeGreaterThanOrEqual(0);
      expect(sendIdx).toBeGreaterThan(autoEnrichIdx);
    });

    it("still sends the first message when auto_enrich fails", async () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      mockRunTool.mockRejectedValueOnce(new Error("disk full"));
      startWithRepo();
      await flush();

      expect(sessionSend).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("skips the pre-run when repo/fileAdapter are absent", async () => {
      useImportStore.getState().startReenrich({
        budgetPath: "/budget",
        budgetName: "Test",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
      });
      await flush();

      expect(mockRunTool).not.toHaveBeenCalled();
      expect(sessionSend).toHaveBeenCalledTimes(1);
    });

    it("cancelReenrich clears enriching state", () => {
      startWithRepo();
      useImportStore.getState().cancelReenrich();
      expect(useImportStore.getState().isEnriching).toBe(false);
      expect(useImportStore.getState().reenrichSession).toBeNull();
    });

    it("persists the enriched flag when re-enrich completes (resume path)", async () => {
      const { fileAdapter } = startWithRepo();
      await flush(); // pre-step + first send
      sessions[0].emitDone();
      await flush();

      expect(mockMarkImportEnriched).toHaveBeenCalledWith(fileAdapter, "/budget");
    });
  });

  // ── Merge teardown ────────────────────────────────────────────────

  describe("resetAfterMerge", () => {
    it("kills a lingering re-enrich session and resets to idle", () => {
      useImportStore.getState().startReenrich({
        budgetPath: "/budget",
        budgetName: "Test",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
        repo: {} as BudgetRepository,
        fileAdapter: {} as FileAdapter,
      });
      sessionKill.mockClear();

      useImportStore.getState().resetAfterMerge();

      expect(sessionKill).toHaveBeenCalled();
      expect(useImportStore.getState().reenrichSession).toBeNull();
      expect(useImportStore.getState().isEnriching).toBe(false);
      expect(useImportStore.getState().phase).toBe("idle");
      expect(useImportStore.getState().hasImportData).toBe(false);
    });
  });
});
