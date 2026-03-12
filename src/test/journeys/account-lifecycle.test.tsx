import "@/test/journeys/setup";
import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { renderApp } from "@/test/render-app";
import { makeAccount, makeTransaction } from "@/test/factories";

// CI runners are ~2-3x slower than local; give journey tests breathing room.
const TIMEOUT = 15_000;

// ── Helpers ─────────────────────────────────────────────────

async function waitForApp() {
  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "All Accounts" })).toBeInTheDocument();
  });
}

/**
 * Find an account name element in the sidebar (inside a Link, not the form selector).
 * The TransactionForm's AccountSelector also renders account names with class="truncate",
 * so we disambiguate by looking for the one inside an <a> tag (TanStack Router Link).
 */
function getSidebarAccountEl(accountName: string): HTMLElement {
  const matches = screen.getAllByText(accountName);
  const inSidebar = matches.find((el) => el.closest("a"));
  if (!inSidebar) throw new Error(`Account "${accountName}" not found in sidebar`);
  return inSidebar;
}

/** Opens the three-dot context menu for an account row in the sidebar. */
async function openAccountMenu(user: UserEvent, accountName: string) {
  const nameEl = getSidebarAccountEl(accountName);
  // <span> → <a> (Link) → <div> (row container)
  const row = nameEl.closest("a")!.parentElement!;
  const buttons = within(row as HTMLElement).getAllByRole("button");
  // Last button in the row is the dropdown trigger (first may be drag handle)
  await user.click(buttons[buttons.length - 1]);
}

// ── Tests ───────────────────────────────────────────────────

describe("Account lifecycle", () => {
  // ── Creating ──────────────────────────────────────────────

  it("creates an account via the sidebar", async () => {
    const { user, repo } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitForApp();

    await user.click(screen.getByRole("button", { name: /add account/i }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Primary Checking");
    await user.click(within(dialog).getByRole("button", { name: "Create Account" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(repo.data.accounts).toHaveLength(1);
    expect(repo.data.accounts[0].name).toBe("Primary Checking");
    expect(repo.data.accounts[0].type).toBe("checking");
  }, TIMEOUT);

  it("creates account with opening balance", async () => {
    const { user, repo } = await renderApp({
      seed: { accounts: [], categories: [], transactions: [] },
    });
    await waitForApp();

    await user.click(screen.getByRole("button", { name: /add account/i }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "BofA Savings");
    await user.click(within(dialog).getByRole("button", { name: "Savings" }));
    await user.type(within(dialog).getByLabelText("Opening Balance"), "5000");
    await user.click(within(dialog).getByRole("button", { name: "Create Account" }));

    // Wait for dialog close and mutation to fully settle (account + opening balance txn)
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(repo.data.transactions).toHaveLength(1);
    });

    expect(repo.data.accounts).toHaveLength(1);
    expect(repo.data.accounts[0].type).toBe("savings");
    expect(repo.data.transactions[0].merchant).toBe("Opening Balance");
    expect(repo.data.transactions[0].amount).toBe(500000);
    expect(repo.data.transactions[0].type).toBe("income");
  }, TIMEOUT);

  // ── Deleting ──────────────────────────────────────────────

  it("deletes an empty account", async () => {
    const account = makeAccount({ id: "acc-1", name: "Empty Account" });
    const { user, repo } = await renderApp({
      seed: { accounts: [account], categories: [], transactions: [] },
    });
    await waitForApp();

    await openAccountMenu(user, "Empty Account");
    const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteItem);

    await waitFor(() => {
      expect(repo.data.accounts).toHaveLength(0);
    });
    // Gone from sidebar and form selector
    expect(screen.queryAllByText("Empty Account")).toHaveLength(0);
  }, TIMEOUT);

  it("cannot delete account with transactions", async () => {
    const account = makeAccount({ id: "acc-1", name: "Active Account" });
    const txn = makeTransaction({
      id: "txn-1",
      accountId: "acc-1",
      amount: -5000,
      merchant: "Store",
    });
    const { user, repo } = await renderApp({
      seed: { accounts: [account], categories: [], transactions: [txn] },
    });
    await waitForApp();

    await openAccountMenu(user, "Active Account");
    const deleteItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteItem);

    // Account and transaction remain unchanged after mutation settles
    await waitFor(() => {
      expect(repo.data.accounts).toHaveLength(1);
      expect(repo.data.transactions).toHaveLength(1);
    });
  }, TIMEOUT);

  // ── Archiving ─────────────────────────────────────────────

  it("cannot archive account with non-zero balance", async () => {
    const account = makeAccount({ id: "acc-1", name: "Funded Account" });
    const txn = makeTransaction({
      id: "txn-1",
      accountId: "acc-1",
      type: "income",
      amount: 10000,
      merchant: "Salary",
    });
    const { user, repo } = await renderApp({
      seed: { accounts: [account], categories: [], transactions: [txn] },
    });
    await waitForApp();

    await openAccountMenu(user, "Funded Account");
    const archiveItem = await screen.findByRole("menuitem", { name: "Archive" });
    await user.click(archiveItem);

    // Account stays active after mutation settles
    await waitFor(() => {
      expect(repo.data.accounts[0].archived).toBe(false);
    });
  }, TIMEOUT);

  it("archives a zero-balance account", async () => {
    const account = makeAccount({ id: "acc-1", name: "Idle Account" });
    const { user, repo } = await renderApp({
      seed: { accounts: [account], categories: [], transactions: [] },
    });
    await waitForApp();

    await openAccountMenu(user, "Idle Account");
    const archiveItem = await screen.findByRole("menuitem", { name: "Archive" });
    await user.click(archiveItem);

    await waitFor(() => {
      expect(repo.data.accounts[0].archived).toBe(true);
    });

    // Archived section appears; expand it to verify account is there
    expect(screen.getByText("Archived")).toBeInTheDocument();
    await user.click(screen.getByText("Archived"));
    expect(screen.getByText("Idle Account")).toBeInTheDocument();
  }, TIMEOUT);

  it("unarchives an account", async () => {
    const account = makeAccount({
      id: "acc-1",
      name: "Dormant Account",
      archived: true,
    });
    const { user, repo } = await renderApp({
      seed: { accounts: [account], categories: [], transactions: [] },
    });
    await waitForApp();

    // Expand archived section
    await user.click(screen.getByText("Archived"));
    expect(screen.getByText("Dormant Account")).toBeInTheDocument();

    await openAccountMenu(user, "Dormant Account");
    const unarchiveItem = await screen.findByRole("menuitem", { name: "Unarchive" });
    await user.click(unarchiveItem);

    await waitFor(() => {
      expect(repo.data.accounts[0].archived).toBe(false);
    });

    // Archived section gone (no more archived accounts)
    expect(screen.queryByText("Archived")).not.toBeInTheDocument();
  }, TIMEOUT);
});
