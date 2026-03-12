import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render-app";
import { makeAccount, makeCategory, makeTransaction } from "@/test/factories";

// ── Seed data ───────────────────────────────────────────────
// Single active account → auto-selected in transaction form.

const checking = makeAccount({ id: "acc-checking", name: "Checking", type: "checking" });
const groceries = makeCategory({ id: "cat-groceries", name: "Groceries", group: "Daily Living" });
const salary = makeCategory({ id: "cat-salary", name: "Salary", group: "Income" });
const existingTxn = makeTransaction({
  id: "txn-1",
  type: "expense",
  amount: -4200,
  accountId: "acc-checking",
  categoryId: "cat-groceries",
  merchant: "Whole Foods",
  datetime: "2026-01-15T12:00:00.000Z",
});

const seed = {
  accounts: [checking],
  categories: [groceries, salary],
  transactions: [existingTxn],
};

// ── Helpers ─────────────────────────────────────────────────

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

function getTransactionTable() {
  return screen.getByRole("table");
}

/** Open the transaction form and wait for the auto-focus timer to settle. */
async function openTransactionForm(user: ReturnType<typeof import("@testing-library/user-event").default.setup>) {
  await user.click(screen.getByRole("button", { name: /add transaction/i }));
  // BudgetShell has a setTimeout(80ms) to auto-focus the amount input.
  // React.StrictMode double-mounts the effect, creating a second timer.
  // Wait for it to fire before interacting with the form.
  const amountInput = screen.getByPlaceholderText("0.00");
  await waitFor(() => {
    expect(amountInput).toHaveFocus();
  });
}

// ── Tests ───────────────────────────────────────────────────

describe("Transaction lifecycle", () => {
  it("shows existing transactions after loading", async () => {
    await renderApp({ seed });
    await waitForApp();

    const table = getTransactionTable();
    expect(within(table).getByText("Whole Foods")).toBeInTheDocument();
    expect(within(table).getByText("-$42.00")).toBeInTheDocument();
    expect(within(table).getByText("Groceries")).toBeInTheDocument();
  });

  it("adds a new expense transaction via the form", async () => {
    const { user, repo } = await renderApp({ seed });
    await waitForApp();

    await openTransactionForm(user);

    // Fill in amount and merchant
    await user.type(screen.getByPlaceholderText("0.00"), "25.50");
    await user.type(screen.getByPlaceholderText("Merchant"), "Target");

    // Submit
    await user.keyboard("{Enter}");

    // The new transaction should appear in the table
    const table = getTransactionTable();
    await waitFor(() => {
      expect(within(table).getByText("Target")).toBeInTheDocument();
    });
    expect(within(table).getByText("-$25.50")).toBeInTheDocument();

    // Verify persistence
    expect(repo.data.transactions).toHaveLength(2);
    const newTxn = repo.data.transactions.find((t) => t.merchant === "Target");
    expect(newTxn).toBeDefined();
    expect(newTxn!.amount).toBe(-2550);
    expect(newTxn!.type).toBe("expense");
  });

  it("adds an income transaction", async () => {
    const { user, repo } = await renderApp({ seed });
    await waitForApp();

    await openTransactionForm(user);

    // Switch to income type
    await user.click(screen.getByRole("button", { name: "Income" }));

    await user.type(screen.getByPlaceholderText("0.00"), "3000");
    await user.type(screen.getByPlaceholderText("Merchant"), "Employer Inc");
    await user.keyboard("{Enter}");

    const table = getTransactionTable();
    await waitFor(() => {
      expect(within(table).getByText("Employer Inc")).toBeInTheDocument();
    });
    expect(within(table).getByText("$3,000.00")).toBeInTheDocument();

    const newTxn = repo.data.transactions.find((t) => t.merchant === "Employer Inc");
    expect(newTxn!.amount).toBe(300000);
    expect(newTxn!.type).toBe("income");
  });

  it("deletes a transaction via the row action menu", async () => {
    const { user, repo } = await renderApp({ seed });
    await waitForApp();

    const table = getTransactionTable();
    const row = within(table).getByText("Whole Foods").closest("tr")!;
    const menuButton = within(row).getByRole("button");
    await user.click(menuButton);

    // Click Delete in the dropdown
    const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteItem);

    // Confirm in dialog
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    // Transaction gone
    await waitFor(() => {
      expect(within(table).queryByText("Whole Foods")).not.toBeInTheDocument();
    });
    expect(repo.data.transactions).toHaveLength(0);
  });

  it("form resets after adding a transaction (ready for the next one)", async () => {
    const { user } = await renderApp({ seed });
    await waitForApp();

    await openTransactionForm(user);

    await user.type(screen.getByPlaceholderText("0.00"), "10");
    await user.type(screen.getByPlaceholderText("Merchant"), "Coffee Shop");
    await user.keyboard("{Enter}");

    // After submission, form should stay open with fields cleared
    await waitFor(() => {
      expect(screen.getByPlaceholderText("0.00")).toHaveValue("");
    });
    expect(screen.getByPlaceholderText("Merchant")).toHaveValue("");
  });
});
