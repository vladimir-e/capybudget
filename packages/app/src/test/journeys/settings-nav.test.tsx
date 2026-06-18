import "@/test/journeys/setup";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { makeCategory } from "@/test/factories";
import {
  _resetIntelligenceStoreForTests,
  _resetStoreForTests,
  _setStoreLoaderForTests,
} from "@/stores/intelligence-store";
import { DEFAULT_INTELLIGENCE_CONFIG } from "@capybudget/intelligence";

beforeEach(() => {
  _resetStoreForTests();
  _resetIntelligenceStoreForTests();
  // Hydrate to a known state — claude-cli with no API key — so the
  // empty-state is OFF and the budget shell renders normally.
  _setStoreLoaderForTests(async () => ({
    get: async () => ({
      ...DEFAULT_INTELLIGENCE_CONFIG,
      provider: "claude-cli",
    }),
    set: async () => {},
  }));
});

const TIMEOUT = 15_000;

describe("Settings navigation", () => {
  it("clicking the gear icon at the bottom of the navigation rail navigates to /budget/settings", async () => {
    const { user } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("link", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
    // Settings opens on the General section (the default landing).
    expect(screen.getByText("Currency")).toBeInTheDocument();
  }, TIMEOUT);

  it("manages categories from the Settings ▸ Categories section", async () => {
    const groceries = makeCategory({ name: "Groceries", group: "Daily Living" });
    const { user } = await renderApp({
      seed: { accounts: [], categories: [groceries], transactions: [] },
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: /Categories/i }));

    await waitFor(() => {
      expect(screen.getByText("Daily Living")).toBeInTheDocument();
    });
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    // The management entry point lives here now, not behind the analytics cog.
    expect(screen.getByRole("button", { name: "Add Group" })).toBeInTheDocument();
  }, TIMEOUT);
});
