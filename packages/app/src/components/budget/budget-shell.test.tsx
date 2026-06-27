import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { makeAccount } from "@/test/factories";

// Full-app mount is heavy; match the journeys' generous per-test budget.
const TIMEOUT = 30_000;
const seed = { accounts: [makeAccount({ id: "acc-1", name: "Checking" })] };
const budgetSearch = { path: "/test-budget", name: "Test Budget" };

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

describe("BudgetShell — history shortcuts", () => {
  it("⌘[ and ⌘] step back and forward through router history", async () => {
    const { router } = await renderApp({ seed });
    await waitForApp();

    await router.navigate({ to: "/budget/categories", search: budgetSearch });
    await waitFor(() => expect(router.state.location.pathname).toBe("/budget/categories"));

    fireEvent.keyDown(window, { key: "[", metaKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe("/budget"));

    fireEvent.keyDown(window, { key: "]", metaKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe("/budget/categories"));
  }, TIMEOUT);

  it("ignores ⌘[ while a text field is focused", async () => {
    const { router } = await renderApp({ seed });
    await waitForApp();

    // A back step must exist, so the assertion distinguishes "guarded" from
    // "nothing to go back to": Accounts → Budget → Accounts.
    await router.navigate({ to: "/budget/categories", search: budgetSearch });
    await waitFor(() => expect(router.state.location.pathname).toBe("/budget/categories"));
    await router.navigate({ to: "/budget", search: budgetSearch });
    await waitFor(() => expect(router.state.location.pathname).toBe("/budget"));

    // Open the transaction form and focus its amount input.
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    const amount = await screen.findByPlaceholderText("0.00");
    await waitFor(() => expect(amount).toHaveFocus());

    // ⌘[ from inside the field is swallowed by the focus guard.
    fireEvent.keyDown(amount, { key: "[", metaKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe("/budget");
  }, TIMEOUT);
});
