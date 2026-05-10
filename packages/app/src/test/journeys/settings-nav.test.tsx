import "@/test/journeys/setup";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
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
  it("clicking the gear icon at the bottom of the navigation rail navigates to /settings", async () => {
    const { user } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
    });

    // Settings now lives at the bottom of the left navigation rail
    // (rendered as a TanStack Link → role="link"), not in the top
    // header where it used to sit.
    await user.click(screen.getByRole("link", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    });
    expect(screen.getByText("AI Provider")).toBeInTheDocument();
  }, TIMEOUT);
});
