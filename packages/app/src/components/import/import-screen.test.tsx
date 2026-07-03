import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { makeImportTransaction } from "@capybudget/core/test-factories";

// checkStaging's routing is what this file exercises — the drop zone, progress
// bar, and preview subtrees are stubbed down to markers.
vi.mock("./import-drop-zone", () => ({
  ImportDropZone: () => <div data-testid="drop-zone" />,
  ProviderUnsupportedBanner: () => <div data-testid="unsupported-banner" />,
}));
vi.mock("./import-progress", () => ({ ImportProgress: () => <div data-testid="progress" /> }));
vi.mock("./import-preview", () => ({ ImportPreview: () => <div data-testid="preview" /> }));

const { mocks } = vi.hoisted(() => ({
  mocks: {
    supported: true,
    start: vi.fn(),
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
    supported: mocks.supported,
    pdfSupported: true,
    start: mocks.start,
    enrich: vi.fn(() => true),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    staging: mocks.staging,
  }),
}));
vi.mock("@/hooks/use-import-repository", () => ({
  useImportRepository: () => ({ listSourceFiles: mocks.listSourceFiles }),
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
  mocks.supported = true;
  mocks.start.mockReset().mockReturnValue(true);
  mocks.listSourceFiles.mockReset().mockResolvedValue([]);
  mocks.staging.readTransactions.mockReset().mockResolvedValue(null);
  mocks.staging.readTransferContext.mockReset().mockResolvedValue(null);
  mocks.staging.readState.mockReset().mockResolvedValue(null);
  mocks.staging.writeState.mockReset().mockResolvedValue(undefined);
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

  it("falls through to file-attach when no staging exists", async () => {
    renderScreen();

    expect(await screen.findByTestId("drop-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("preview")).toBeNull();
    expect(useImportStore.getState().hasImportData).toBe(false);
  });

  // Runs under both `npm test` and `npm run test:mas`: the set-up-AI nudge is
  // the intended no-provider state in every variant. It's the same affordance
  // the Capy chat surface shows when unconfigured.
  it("shows the set-up-AI nudge instead of the drop zone when no provider is configured", async () => {
    mocks.supported = false;
    renderScreen();

    expect(await screen.findByTestId("unsupported-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("drop-zone")).toBeNull();
  });

  // The reported MAS bug: the sandbox's empty fs scope denies the mount-time
  // staging probe, so the read rejects. The screen must still settle to a real
  // state (here the no-provider nudge) rather than wedge on the loading spinner.
  it("settles to the nudge when the staging probe is denied (MAS sandbox)", async () => {
    mocks.supported = false;
    mocks.staging.readTransactions.mockRejectedValue(new Error("forbidden path"));
    renderScreen();

    expect(await screen.findByTestId("unsupported-banner")).toBeInTheDocument();
  });
});
