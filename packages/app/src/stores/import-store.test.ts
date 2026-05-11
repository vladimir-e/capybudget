import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";

// ── Mocks ──────────────────────────────────────────────────────────

const mockRunTool = vi.fn<
  (
    name: string,
    input: Record<string, unknown>,
    ctx: unknown,
  ) => Promise<string>
>();

// Capture send() calls + their ordering relative to runTool() so we
// can assert the pre-run auto_enrich lands before the first message.
const sessionSend = vi.fn<(message: unknown) => Promise<void>>();
const sessionKill = vi.fn<() => Promise<void>>();
const callOrder: string[] = [];

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

vi.mock("@/services/create-session", () => ({
  createSession: vi.fn(() => ({
    send: (msg: unknown) => {
      callOrder.push("send");
      return sessionSend(msg);
    },
    kill: () => sessionKill(),
    stop: vi.fn(),
    restart: vi.fn(),
    isAlive: true,
  })),
}));

import { useImportStore } from "@/stores/import-store";

// ── Tests ──────────────────────────────────────────────────────────

describe("import-store", () => {
  beforeEach(() => {
    useImportStore.setState({
      hasImportData: false,
      phase: "idle",
      enrichSession: null,
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

  describe("startEnrichment", () => {
    const startWithRepo = () => {
      const repo = {} as BudgetRepository;
      const fileAdapter = {} as FileAdapter;
      useImportStore.getState().startEnrichment({
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
      // The store dispatches send() inside a .then() chained off the
      // auto_enrich promise — flush microtasks so the chain settles.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRunTool).toHaveBeenCalledWith(
        "auto_enrich",
        {},
        expect.objectContaining({
          repo,
          fileAdapter,
          budgetPath: "/budget",
        }),
      );

      // Ordering: auto_enrich must complete before send() fires.
      const autoEnrichIdx = callOrder.indexOf("runTool:auto_enrich");
      const sendIdx = callOrder.indexOf("send");
      expect(autoEnrichIdx).toBeGreaterThanOrEqual(0);
      expect(sendIdx).toBeGreaterThan(autoEnrichIdx);
    });

    it("still sends the first message when auto_enrich fails", async () => {
      // Swallow the expected console.warn so it doesn't pollute test output.
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      mockRunTool.mockRejectedValueOnce(new Error("disk full"));
      startWithRepo();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Failure is swallowed — the model can call auto_enrich itself as fallback.
      expect(sessionSend).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("skips the pre-run when repo/fileAdapter are absent", async () => {
      useImportStore.getState().startEnrichment({
        budgetPath: "/budget",
        budgetName: "Test",
        mcpServerPath: "/mcp",
        systemPrompt: "you are capy",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockRunTool).not.toHaveBeenCalled();
      expect(sessionSend).toHaveBeenCalledTimes(1);
    });
  });
});
