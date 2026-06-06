import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";
import { ENRICH_INSTRUCTION, IMPORT_PIPELINE } from "@capybudget/intelligence";

// ── Mocks ──────────────────────────────────────────────────────────

const mockRunTool = vi.fn<
  (
    name: string,
    input: Record<string, unknown>,
    ctx: unknown,
  ) => Promise<string>
>();

vi.mock("@capybudget/intelligence", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    runTool: (name: string, input: Record<string, unknown>, ctx: unknown) => {
      callOrder.push(`runTool:${name}`);
      return mockRunTool(name, input, ctx);
    },
  };
});

// Each created session is a tracked instance: its send() calls (with the
// emitted onEvent handler) let tests drive the stream and assert that the
// enrich turn injects into the SAME session, not a new one.
interface MockSession {
  id: number;
  sends: unknown[];
  onEvent: (event: { type: string; blocks?: unknown[]; message?: string }) => void;
  emitContent: (text: string) => void;
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
      const session: MockSession = {
        id,
        sends: [],
        onEvent: opts.onEvent,
        emitContent(text: string) {
          this.onEvent({ type: "content", blocks: [{ type: "text", content: text }] });
        },
        emitDone() {
          this.onEvent({ type: "done" });
        },
      };
      sessions.push(session);
      return {
        send: (msg: unknown) => {
          callOrder.push("send");
          session.sends.push(msg);
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
      reenrichSession: null,
      isEnriching: false,
      enrichStatusText: "",
    });
    mockRunTool.mockReset();
    mockRunTool.mockResolvedValue("ok");
    sessionSend.mockReset();
    sessionSend.mockResolvedValue();
    sessionKill.mockReset();
    sessionKill.mockResolvedValue();
    callOrder.length = 0;
    sessions.length = 0;
    sessionCounter = 0;
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

    it("kickoff phase carries no injected instruction", () => {
      expect(IMPORT_PIPELINE[0].instruction).toBeNull();
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
      // Walk normalize → enrich → done; no phase spawns a new session.
      sessions[0].emitDone(); // normalize done → advance to enrich
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

    it("transitions normalize → enriching → review in order", async () => {
      startRun();
      const seen: string[] = [useImportStore.getState().phase];

      sessions[0].emitDone();
      await flush();
      seen.push(useImportStore.getState().phase);

      sessions[0].emitDone();
      await flush();
      seen.push(useImportStore.getState().phase);

      expect(seen).toEqual(["normalizing", "enriching", "review"]);
    });

    it("injects the enrich instruction as a new turn into the SAME session", async () => {
      startRun();
      sessions[0].emitDone(); // normalize done
      await flush();

      // Same session received a second send() — sequential injection, not a
      // fresh session.
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sends).toEqual([
        "normalize these files",
        ENRICH_INSTRUCTION,
      ]);
    });

    it("runs the auto_enrich pre-step before injecting the enrich turn", async () => {
      const { repo, fileAdapter } = startRun();
      callOrder.length = 0; // ignore the kickoff send

      sessions[0].emitDone(); // normalize done → enrich pre-step then inject
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

    it("lands on review and marks import data present when the run completes", async () => {
      startRun();
      sessions[0].emitDone();
      await flush();
      sessions[0].emitDone();
      await flush();

      expect(useImportStore.getState().phase).toBe("review");
      expect(useImportStore.getState().hasImportData).toBe(true);
    });

    it("fires onRunComplete when the run lands on review", async () => {
      const onComplete = vi.fn();
      useImportStore.getState().setOnRunComplete(onComplete);
      startRun();
      sessions[0].emitDone();
      await flush();
      sessions[0].emitDone();
      await flush();

      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("cancel resets to idle and kills the session", async () => {
      startRun();
      sessions[0].emitDone(); // mid-run (now enriching)
      await flush();
      expect(useImportStore.getState().phase).toBe("enriching");

      useImportStore.getState().cancelRun();

      expect(useImportStore.getState().phase).toBe("idle");
      expect(useImportStore.getState().runSession).toBeNull();
      expect(useImportStore.getState().runMessages).toEqual([]);
      expect(sessionKill).toHaveBeenCalled();
    });

    it("does not inject the enrich turn if cancelled during the pre-step", async () => {
      // Make auto_enrich hang until we cancel, simulating a mid-pre-step cancel.
      let resolvePreStep: (v: string) => void = () => {};
      mockRunTool.mockImplementationOnce(
        () => new Promise<string>((r) => { resolvePreStep = r; }),
      );

      startRun();
      const sendsBefore = sessions[0].sends.length;
      sessions[0].emitDone(); // normalize done → enrich pre-step starts (hangs)
      await flush();

      useImportStore.getState().cancelRun(); // user cancels during pre-step
      resolvePreStep("ok"); // pre-step finishes after cancel
      await flush();

      // The enrich turn must NOT have been injected.
      expect(sessions[0].sends.length).toBe(sendsBefore);
      expect(useImportStore.getState().phase).toBe("idle");
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
  });
});
