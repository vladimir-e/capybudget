import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { makeCategory } from "@/test/factories";

// ── Helpers ─────────────────────────────────────────────────

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

// ── Tests ───────────────────────────────────────────────────

// CI runners are ~2-3x slower than local; give journey tests breathing room.
const TIMEOUT = 15_000;

describe("Fresh start", () => {
  it("prompts to create an account when adding a transaction with no accounts", async () => {
    const { user } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitForApp();

    // "Add transaction" should redirect to account creation
    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add Account")).toBeInTheDocument();
  }, TIMEOUT);

  it("creates first account then adds first transaction", async () => {
    const groceries = makeCategory({ id: "cat-groceries", name: "Groceries" });
    const { user, repo } = await renderApp({
      seed: { accounts: [], categories: [groceries], transactions: [] },
    });
    await waitForApp();

    // Step 1: Click "Add transaction" → account dialog opens (no accounts yet)
    await user.click(screen.getByRole("button", { name: /add transaction/i }));
    const dialog = await screen.findByRole("dialog");

    // Step 2: Create an account
    await user.type(within(dialog).getByLabelText("Name"), "My Checking");
    await user.click(within(dialog).getByRole("button", { name: "Create Account" }));

    // Dialog closes, account created
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(repo.data.accounts).toHaveLength(1);
    expect(repo.data.accounts[0].name).toBe("My Checking");

    // Step 3: Now "Add transaction" opens the form
    await user.click(screen.getByRole("button", { name: /add transaction/i }));
    const amountInput = screen.getByPlaceholderText("0.00");
    await waitFor(() => expect(amountInput).toHaveFocus());

    await user.type(amountInput, "42.50");
    await user.type(screen.getByPlaceholderText("Merchant"), "Corner Store");
    await user.keyboard("{Enter}");

    // Transaction appears in the table
    const table = screen.getByRole("table");
    await waitFor(() => {
      expect(within(table).getByText("Corner Store")).toBeInTheDocument();
    });
    expect(within(table).getByText("-$42.50")).toBeInTheDocument();

    // Verify persistence
    expect(repo.data.accounts[0].name).toBe("My Checking");
    expect(repo.data.transactions).toHaveLength(1);
    expect(repo.data.transactions[0].amount).toBe(-4250);
  }, TIMEOUT);
});
