import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeImportTransaction } from "@capybudget/core/test-factories";

// checkStaging's routing is what this file exercises — the drop zone, progress
// bar, and preview subtrees are stubbed down to markers. The preview stub mirrors
// the real one's discard registration, so the cancel-teardown tests can observe it.
vi.mock("./import-drop-zone", () => ({
  ImportDropZone: () => <div data-testid="drop-zone" />,
}));
vi.mock("./import-progress", () => ({ ImportProgress: () => <div data-testid="progress" /> }));
vi.mock("./import-preview", () => ({
  ImportPreview: ({ onRegisterDiscard }: { onRegisterDiscard: (d: (() => void) | null) => void }) => {
    useEffect(() => {
      onRegisterDiscard(mocks.discard);
      return () => onRegisterDiscard(null);
    }, [onRegisterDiscard]);
    return <div data-testid="preview" />;
  },
}));

const { mocks } = vi.hoisted(() => ({
  mocks: {
    canStart: true,
    provider: "anthropic" as string | null,
    start: vi.fn(),
    discard: vi.fn(),
    clearImportData: vi.fn(),
    staging: {
      readTransactions: vi.fn(),
      readTransferContext: vi.fn(),
      readState: vi.fn(),
      writeState: vi.fn(),
    },
    listSourceFiles: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/use-import-orchestrator", () => ({
  useImportOrchestrator: () => ({
    canStart: mocks.canStart,
    provider: mocks.provider,
    pdfSupported: true,
    start: mocks.start,
    enrich: vi.fn(() => true),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    staging: mocks.staging,
  }),
}));
vi.mock("@/hooks/use-import-repository", () => ({
  useImportRepository: () => ({
    listSourceFiles: mocks.listSourceFiles,
    clearImportData: mocks.clearImportData,
  }),
}));
vi.mock("@/hooks/use-custom-instructions", () => ({
  useImportInstructions: () => ({ instructions: "", isLoading: false, save: vi.fn(async () => {}) }),
}));
vi.mock("@/hooks/use-budget-data", () => ({ useAccounts: () => ({ data: [] }) }));

import { ImportScreen } from "./import-screen";
import { useImportStore } from "@/stores/import-store";

beforeEach(() => {
  useImportStore.getState().reset();
  useImportStore.getState().setHasImportData(false);
  mocks.canStart = true;
  mocks.provider = "anthropic";
  mocks.start.mockReset().mockReturnValue(true);
  mocks.listSourceFiles.mockReset().mockResolvedValue([]);
  mocks.staging.readTransactions.mockReset().mockResolvedValue(null);
  mocks.staging.readTransferContext.mockReset().mockResolvedValue(null);
  mocks.staging.readState.mockReset().mockResolvedValue(null);
  mocks.staging.writeState.mockReset().mockResolvedValue(undefined);
  mocks.discard.mockReset();
  mocks.clearImportData.mockReset().mockResolvedValue(undefined);
});

function renderScreen() {
  return render(<ImportScreen budgetPath="/b" budgetName="Budget" />);
}

describe("ImportScreen — checkStaging routing", () => {
  it("lands on the preview when staged rows exist", async () => {
    mocks.staging.readTransactions.mockResolvedValue({
      rows: [makeImportTransaction({ id: "imp-1" })],
      dropped: [],
      fixed: [],
    });
    renderScreen();

    expect(await screen.findByTestId("preview")).toBeInTheDocument();
    expect(screen.queryByTestId("drop-zone")).toBeNull();
    expect(useImportStore.getState().hasImportData).toBe(true);
  });

  it("still lands on the preview when read-validation dropped every staged row", async () => {
    // The recoverable path: the preview surfaces the skipped-rows note and the
    // header's Cancel discards. Falling through to file-attach would wedge the
    // user — the chat on-ramp refuses while transactions.csv exists.
    mocks.staging.readTransactions.mockResolvedValue({
      rows: [],
      dropped: ['Row 1: invalid date "Pending", row dropped'],
      fixed: [],
    });
    renderScreen();

    expect(await screen.findByTestId("preview")).toBeInTheDocument();
    expect(screen.queryByTestId("drop-zone")).toBeNull();
    expect(useImportStore.getState().hasImportData).toBe(true);
  });

  it("clears merged-marked staging instead of resuming it (self-heals a failed post-merge clear)", async () => {
    // A prior merge committed but its post-merge clear failed, leaving
    // transactions.csv + a merged marker. checkStaging must treat it as debris:
    // retry the clear, land on file-attach, and never resume it as a fresh import
    // (which would double the already-merged rows).
    mocks.staging.readTransactions.mockResolvedValue({
      rows: [makeImportTransaction({ id: "imp-1" })],
      dropped: [],
      fixed: [],
    });
    mocks.staging.readState.mockResolvedValue({
      phase: "done",
      updatedAt: "2026-01-01T00:00:00Z",
      merged: true,
    });
    renderScreen();

    expect(await screen.findByTestId("drop-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).toBeNull();
    await waitFor(() => expect(mocks.clearImportData).toHaveBeenCalled());
    expect(mocks.start).not.toHaveBeenCalled();
    expect(useImportStore.getState().hasImportData).toBe(false);
  });

  it("stays on file-attach when the merged-staging cleanup retry also fails", async () => {
    mocks.staging.readTransactions.mockResolvedValue({
      rows: [makeImportTransaction({ id: "imp-1" })],
      dropped: [],
      fixed: [],
    });
    mocks.staging.readState.mockResolvedValue({
      phase: "done",
      updatedAt: "2026-01-01T00:00:00Z",
      merged: true,
    });
    mocks.clearImportData.mockRejectedValueOnce(new Error("still present"));
    renderScreen();

    expect(await screen.findByTestId("drop-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).toBeNull();
  });

  it("auto-starts a chat-staged import and clears the chat marker first", async () => {
    mocks.staging.readState.mockResolvedValue({
      phase: "reading",
      source: "chat",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    renderScreen();

    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.staging.writeState).toHaveBeenCalledWith(
      expect.objectContaining({ source: undefined }),
    );
    expect(useImportStore.getState().hasImportData).toBe(true);
  });

  it("does not re-fire over a chat staging when a run is already in flight", async () => {
    useImportStore.setState({ running: true });
    mocks.staging.readState.mockResolvedValue({
      phase: "reading",
      source: "chat",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    renderScreen();

    await waitFor(() => expect(mocks.listSourceFiles).toHaveBeenCalled());
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("serializes the checks so a chat signal at mount can't double-fire start()", async () => {
    // Stateful staging: readState reflects the last writeState. The mount check
    // auto-starts and clears the chat marker; a signal-driven re-check chained
    // after it then reads no chat source and stands down. Unserialized, both
    // checks could read source:"chat" before either cleared it and start twice.
    let state: { phase: string; source?: string; updatedAt: string } | null = {
      phase: "reading",
      source: "chat",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    mocks.staging.readState.mockImplementation(async () => state);
    mocks.staging.writeState.mockImplementation(async (next) => {
      state = next;
    });

    renderScreen();
    // Fire the re-check signal right after mount, while the first check may still
    // be in flight — the serialization is exactly what defuses the race.
    act(() => useImportStore.getState().signalChatImport());

    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    // The re-check reaching its no-staging fall-through proves it ran after the
    // marker was cleared rather than firing a second start().
    await waitFor(() => expect(mocks.listSourceFiles).toHaveBeenCalled());
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("falls through to file-attach when no staging exists", async () => {
    renderScreen();

    expect(await screen.findByTestId("drop-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).toBeNull();
    expect(useImportStore.getState().hasImportData).toBe(false);
  });

  // Regression: a rejecting staging probe must settle the screen, never wedge the spinner.
  it("settles to file-attach when the staging probe is denied (MAS sandbox)", async () => {
    mocks.staging.readTransactions.mockRejectedValue(new Error("forbidden path"));
    renderScreen();

    expect(await screen.findByTestId("drop-zone")).toBeInTheDocument();
  });

  // Regression: a prior budget's run leaves the global rowsVersion non-zero. A
  // fresh Start zeroes it (beginRun), so unless the preview baseline re-bases when
  // the run begins, the run's batches (1, 2, …) never exceed the stale mount
  // baseline and the preview stays hidden. This is the scenario a test would catch.
  it("renders the preview for a fresh run when the mount baseline was left non-zero", async () => {
    useImportStore.setState({ rowsVersion: 6 });
    renderScreen();
    await screen.findByTestId("drop-zone");

    // A fresh run begins (rowsVersion → 0), then its first batch lands.
    act(() => useImportStore.getState().beginRun("start"));
    act(() => useImportStore.getState().apply({ type: "rows-changed" }));

    expect(await screen.findByTestId("preview")).toBeInTheDocument();
  });
});

describe("ImportScreen — cancel teardown", () => {
  async function renderPreviewAndDiscard() {
    mocks.staging.readTransactions.mockResolvedValue({
      rows: [makeImportTransaction({ id: "imp-1" })],
      dropped: [],
      fixed: [],
    });
    renderScreen();
    await screen.findByTestId("preview");
    await userEvent.click(screen.getByRole("button", { name: "Cancel Import" }));
    await userEvent.click(await screen.findByRole("button", { name: "Discard import" }));
  }

  it("drops the preview's pending write-back before clearing staging", async () => {
    await renderPreviewAndDiscard();

    await waitFor(() => expect(mocks.clearImportData).toHaveBeenCalled());
    // discard() must run before clearImportData() — it kills the one timer that
    // could otherwise fire during the clear's awaits and resurrect staging.
    expect(mocks.discard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearImportData.mock.invocationCallOrder[0],
    );
  });

  it("leaves the preview live (generation untouched) when the clear fails", async () => {
    mocks.clearImportData.mockRejectedValueOnce(new Error("still present"));
    const genBefore = useImportStore.getState().stagingGeneration;
    await renderPreviewAndDiscard();

    await waitFor(() => expect(mocks.clearImportData).toHaveBeenCalled());
    // A failed clear must not bump the generation: the still-mounted preview's
    // captured generation stays valid, so a later hand-edit keeps persisting. The
    // discard already ran, but dropping the timer is safe — an edit re-arms it.
    expect(useImportStore.getState().stagingGeneration).toBe(genBefore);
    expect(mocks.discard).toHaveBeenCalled();
    expect(screen.getByTestId("preview")).toBeInTheDocument();
  });
});
