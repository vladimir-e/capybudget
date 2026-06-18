import "@/test/journeys/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

// In-memory fs so the shared budget.json query round-trips a rename without
// touching disk — the same behavior the real Tauri fs gives us.
const fsStore = new Map<string, string>();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (path: string) => {
    const content = fsStore.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    fsStore.set(path, content);
  }),
  rename: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn(async (path: string) => fsStore.has(path)),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { renderApp } from "@/test/render-app";
import { useAppStore } from "@/stores/app-store";

beforeEach(() => {
  fsStore.clear();
  useAppStore.setState({
    recentBudgets: [
      { path: "/test-budget", name: "Test Budget", lastOpened: "2026-01-01T00:00:00.000Z" },
    ],
  });
});

afterEach(() => {
  useAppStore.setState({ recentBudgets: [] });
});

// The budget layout owns the Capy session and threads the budget name into the
// nav links + header. Before this fix it read the name from the URL search
// param, so a rename only reflected after closing and reopening the budget.
describe("Renaming a budget reflects live without a reopen", () => {
  it("threads the new name into the nav links and recents while the layout stays mounted", async () => {
    const { user } = await renderApp({ seed: { accounts: [], categories: [], transactions: [] } });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    const railSettings = () => screen.getByRole("link", { name: "Settings" });
    expect(railSettings().getAttribute("href")).toContain("name=Test+Budget");

    // Rename from the Settings General section — a different surface than the
    // layout that owns the name.
    await user.click(railSettings());
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
    const nameInput = screen.getByLabelText("Budget name");
    await user.clear(nameInput);
    await user.type(nameInput, "Travel Fund");
    await user.tab();

    // Back to the budget — the layout (and its Capy session) never unmounted;
    // only the settings↔shell child swapped. The back-nav even re-threads the
    // *stale* URL name, so the rail showing the new one proves it derives from
    // budget.json, not the search param.
    await user.click(screen.getByRole("button", { name: "Back to budget" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(railSettings().getAttribute("href")).toContain("name=Travel+Fund");
    });

    // The home-screen recents entry tracks the rename too.
    expect(useAppStore.getState().recentBudgets[0]?.name).toBe("Travel Fund");
  }, 15_000);
});
