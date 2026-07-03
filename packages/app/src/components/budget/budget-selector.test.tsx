import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { useAppStore } from "@/stores/app-store";
import { flagReopenFailure, consumeReopenFailure } from "@/lib/reopen-failure";

declare const __MAS__: boolean;

// The selector imports its budget service via a deep relative path; mock at
// the same path so vi.mock can resolve it.
const mockInspectFolder = vi.fn();
const mockDetectBudget = vi.fn();
const mockBootstrapBudget = vi.fn();
const mockFindMissingBudgetPaths = vi.fn();

vi.mock("../../../../../src/services/budget", () => ({
  inspectFolder: (...args: unknown[]) => mockInspectFolder(...args),
  detectBudget: (...args: unknown[]) => mockDetectBudget(...args),
  bootstrapBudget: (...args: unknown[]) => mockBootstrapBudget(...args),
  findMissingBudgetPaths: (...args: unknown[]) => mockFindMissingBudgetPaths(...args),
}));

// plugin-dialog and plugin-fs are already vi.mocked in test/setup.ts;
// we just need handles to set their implementations per-test.
import { open as pickerOpen } from "@tauri-apps/plugin-dialog";
import { exists as fsExists } from "@tauri-apps/plugin-fs";
const mockPickerOpen = vi.mocked(pickerOpen);
const mockFsExists = vi.mocked(fsExists);

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMissingBudgetPaths.mockResolvedValue([]);
  mockFsExists.mockResolvedValue(true);
  useAppStore.setState({ recentBudgets: [] });
});

async function clickButton(name: RegExp) {
  const { user } = await renderApp({ url: "/" });
  await screen.findByRole("button", { name: /new budget/i });
  await user.click(screen.getByRole("button", { name }));
  return user;
}

describe("BudgetSelector — validation modal", () => {
  it("New on a non-empty no-budget folder shows 'isn't empty' modal", async () => {
    mockPickerOpen.mockResolvedValue("/some/messy/folder");
    mockInspectFolder.mockResolvedValue({ hasBudget: false, isEmpty: false, itemCount: 3 });

    await clickButton(/new budget/i);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText(/this folder isn.t empty/i)).toBeInTheDocument();
    expect(screen.getByText(/pick an empty folder to start a new budget/i)).toBeInTheDocument();
  });

  it("Open on a non-empty no-budget folder shows 'no budget here' modal", async () => {
    mockPickerOpen.mockResolvedValue("/some/messy/folder");
    mockInspectFolder.mockResolvedValue({ hasBudget: false, isEmpty: false, itemCount: 1 });

    await clickButton(/open existing/i);

    await waitFor(() => {
      expect(screen.getByText(/no budget in this folder/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/pick a folder that already has a budget/i),
    ).toBeInTheDocument();
  });

  it("'Pick another folder' reopens the picker for the same intent", async () => {
    mockPickerOpen.mockResolvedValueOnce("/folder1");
    mockInspectFolder.mockResolvedValueOnce({ hasBudget: false, isEmpty: false, itemCount: 2 });

    const user = await clickButton(/new budget/i);

    const retry = await screen.findByRole("button", { name: /pick another folder/i });

    mockPickerOpen.mockResolvedValueOnce("/folder2");
    mockInspectFolder.mockResolvedValueOnce({ hasBudget: false, isEmpty: true, itemCount: 0 });
    mockBootstrapBudget.mockResolvedValueOnce({
      schemaVersion: 3,
      name: "folder2",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    });

    await user.click(retry);

    await waitFor(() => {
      expect(mockPickerOpen).toHaveBeenCalledTimes(2);
    });
    // Empty folder opens the create dialog, not an immediate bootstrap.
    await user.click(await screen.findByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(mockBootstrapBudget).toHaveBeenCalledWith("/folder2", "folder2", "USD");
    });
  });
});

describe("BudgetSelector — converged routing", () => {
  it("New on an existing budget folder just opens it (no error)", async () => {
    mockPickerOpen.mockResolvedValue("/already/a/budget");
    mockInspectFolder.mockResolvedValue({ hasBudget: true, isEmpty: false, itemCount: 4 });
    mockDetectBudget.mockResolvedValue({
      schemaVersion: 3,
      name: "Existing",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    });

    await clickButton(/new budget/i);

    await waitFor(() => {
      expect(mockDetectBudget).toHaveBeenCalledWith("/already/a/budget");
    });
    expect(mockBootstrapBudget).not.toHaveBeenCalled();
    // No error modal.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Open on an empty folder bootstraps a new budget (empty-folder fallback)", async () => {
    mockPickerOpen.mockResolvedValue("/empty/folder");
    mockInspectFolder.mockResolvedValue({ hasBudget: false, isEmpty: true, itemCount: 0 });
    mockBootstrapBudget.mockResolvedValue({
      schemaVersion: 3,
      name: "folder",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    });

    const user = await clickButton(/open existing/i);

    await user.click(await screen.findByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(mockBootstrapBudget).toHaveBeenCalledWith("/empty/folder", "folder", "USD");
    });
  });

  it("the create dialog passes the chosen name + currency to bootstrap", async () => {
    mockPickerOpen.mockResolvedValue("/empty/folder");
    mockInspectFolder.mockResolvedValue({ hasBudget: false, isEmpty: true, itemCount: 0 });
    mockBootstrapBudget.mockResolvedValue({
      schemaVersion: 3,
      name: "Travel",
      currency: "EUR",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    });

    const user = await clickButton(/new budget/i);

    const nameInput = await screen.findByLabelText(/name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Travel");

    const trigger = document.getElementById("budget-currency")!;
    await user.click(trigger);
    await user.click(await screen.findByText("Euro"));

    await user.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => {
      expect(mockBootstrapBudget).toHaveBeenCalledWith("/empty/folder", "Travel", "EUR");
    });
    // Opening the 47-item currency popover renders slowly under CI concurrency.
  }, 15000);
});

describe("BudgetSelector — recents", () => {
  it("prunes missing recents on mount (desktop); keeps them under the sandbox", async () => {
    useAppStore.setState({
      recentBudgets: [
        { path: "/keep/a", name: "Keep A", lastOpened: "2026-01-01T00:00:00.000Z" },
        { path: "/gone/b", name: "Gone B", lastOpened: "2026-01-02T00:00:00.000Z" },
      ],
    });
    mockFindMissingBudgetPaths.mockResolvedValue(["/gone/b"]);

    await renderApp({ url: "/" });

    if (__MAS__) {
      // Under the sandbox an unreachable folder means access lapsed, not
      // deletion — the recent stays so its access can be re-granted on click,
      // and the mount-time prune never runs.
      await screen.findByText("Keep A");
      expect(useAppStore.getState().recentBudgets.map((b) => b.path)).toEqual([
        "/keep/a",
        "/gone/b",
      ]);
      expect(mockFindMissingBudgetPaths).not.toHaveBeenCalled();
    } else {
      await waitFor(() => {
        expect(useAppStore.getState().recentBudgets.map((b) => b.path)).toEqual([
          "/keep/a",
        ]);
      });
    }
  });

  it("clicking a stale recent removes it (desktop); re-prompts for the folder under the sandbox", async () => {
    useAppStore.setState({
      recentBudgets: [
        { path: "/dead/path", name: "Dead", lastOpened: "2026-01-01T00:00:00.000Z" },
      ],
    });
    // Prune helper says nothing missing (race: folder vanished after prune ran).
    mockFindMissingBudgetPaths.mockResolvedValue([]);
    // Then on click, exists() returns false.
    mockFsExists.mockResolvedValue(false);

    const { user } = await renderApp({ url: "/" });
    await user.click(await screen.findByText("Dead"));

    if (__MAS__) {
      // The sandbox re-opens the folder picker at the stale path so re-selecting
      // restores access; the recent is kept, not pruned.
      await waitFor(() => {
        expect(mockPickerOpen).toHaveBeenCalledWith(
          expect.objectContaining({ defaultPath: "/dead/path" }),
        );
      });
      expect(useAppStore.getState().recentBudgets).toHaveLength(1);
    } else {
      await waitFor(() => {
        expect(useAppStore.getState().recentBudgets).toHaveLength(0);
      });
    }
  });
});

describe("BudgetSelector — reopen-failure notice", () => {
  beforeEach(() => {
    consumeReopenFailure();
  });

  it("shows the budget name and missing path when the launch redirect flagged a reopen failure", async () => {
    flagReopenFailure({ path: "/moved/budget", name: "Household" });

    await renderApp({ url: "/" });

    expect(await screen.findByText(/could not open household/i)).toBeInTheDocument();
    expect(screen.getByText(/\/moved\/budget/)).toBeInTheDocument();
    // No recovery button — the recents list below is the way back in.
    expect(screen.queryByRole("button", { name: /choose folder/i })).not.toBeInTheDocument();
  });

  it("dismiss clears the notice", async () => {
    flagReopenFailure({ path: "/moved/budget", name: "Household" });

    const { user } = await renderApp({ url: "/" });
    await screen.findByText(/could not open household/i);
    await user.click(screen.getByRole("button", { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByText(/could not open household/i)).not.toBeInTheDocument();
    });
  });
});
