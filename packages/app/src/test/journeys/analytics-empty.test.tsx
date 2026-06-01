import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "@/test/render-app";

// CI runners are ~2-3x slower than local; give journey tests breathing room.
const TIMEOUT = 15_000;

describe("Analytics empty states", () => {
  // Locks the AnalyticsView → tab wiring: the view derives the whole-budget
  // signal (transactions.length > 0) and threads it to every tab. A brand-new
  // budget must reach the tab as `false`, surfacing the calm "more data" copy
  // rather than a period-scoped "no data in this period".
  it("shows the brand-new-budget copy on an empty budget", async () => {
    const { user } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
      url: "/budget/categories?path=/test-budget&name=Test+Budget",
    });

    // Click Spending explicitly: the active tab is module-level store state,
    // so pinning it here keeps the test independent of execution order.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Spending" })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Spending" }));

    expect(
      await screen.findByText("This will be useful once you have more data."),
    ).toBeInTheDocument();
  }, TIMEOUT);
});
