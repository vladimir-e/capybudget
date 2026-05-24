import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Category, Transaction } from "@capybudget/core";
import { PatternsTab } from "./patterns-tab";
import { makeAccount, makeCategory, makeTransaction } from "@/test/factories";

let mockAccounts: Account[] = [];
let mockCategories: Category[] = [];
let mockAllTransactions: Transaction[] = [];

vi.mock("@/hooks/use-budget-data", () => ({
  budgetKeys: {
    all: ["budget"],
    accounts: () => ["budget", "accounts"],
    categories: () => ["budget", "categories"],
    transactions: () => ["budget", "transactions"],
  },
  useAccounts: () => ({ data: mockAccounts }),
  useCategories: () => ({ data: mockCategories }),
  useTransactions: () => ({ data: mockAllTransactions }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const acc = makeAccount({ id: "acc", name: "Checking" });
const groceries = makeCategory({ id: "cat-g", name: "Groceries", group: "Daily Living" });

// Two duplicates on the same day (same account, amount, merchant) — high.
const dup1 = makeTransaction({
  id: "dup-1",
  accountId: acc.id,
  categoryId: groceries.id,
  type: "expense",
  amount: -1500,
  datetime: "2026-03-10T10:00:00.000Z",
  merchant: "Coffee Shop",
});
const dup2 = makeTransaction({
  id: "dup-2",
  accountId: acc.id,
  categoryId: groceries.id,
  type: "expense",
  amount: -1500,
  datetime: "2026-03-10T14:00:00.000Z",
  merchant: "Coffee Shop",
});

// Six monthly Netflix charges — recurring monthly.
const netflix = Array.from({ length: 6 }, (_, i) => {
  const month = (i + 1).toString().padStart(2, "0");
  return makeTransaction({
    id: `nf-${i}`,
    accountId: acc.id,
    categoryId: groceries.id,
    type: "expense",
    amount: -1599,
    datetime: `2026-${month}-15T10:00:00.000Z`,
    merchant: "Netflix",
  });
});

// An unrelated single transaction so the list isn't pristine.
const stray = makeTransaction({
  id: "stray",
  accountId: acc.id,
  categoryId: groceries.id,
  type: "expense",
  amount: -800,
  datetime: "2026-02-22T10:00:00.000Z",
  merchant: "One-Off Bodega",
});

const txns: Transaction[] = [dup1, dup2, ...netflix, stray];

beforeEach(() => {
  mockAccounts = [acc];
  mockCategories = [groceries];
  mockAllTransactions = txns;
});

afterEach(() => {
  cleanup();
});

describe("PatternsTab", () => {
  it("renders detected subscriptions and duplicates", () => {
    renderWithProviders(<PatternsTab transactions={txns} />);

    expect(screen.getByText("Subscriptions")).toBeInTheDocument();
    expect(screen.getByText("Duplicates")).toBeInTheDocument();
    // Netflix card present.
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    // Duplicate card present (uses merchant as label).
    expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
  });

  it("clicking a duplicate group opens the modal scoped to that group's transactionIds", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PatternsTab transactions={txns} />);

    // The duplicate card is rendered as a <button>; the merchant label is
    // inside it. Click the card.
    const card = screen.getByText("Coffee Shop").closest("button");
    expect(card).not.toBeNull();
    await user.click(card!);

    const dialog = await screen.findByRole("dialog", { name: /Review duplicates/i });
    // Both duplicate rows present.
    const rows = within(dialog).getAllByText("Coffee Shop");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // None of the other transactions leak in.
    expect(within(dialog).queryByText("Netflix")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("One-Off Bodega")).not.toBeInTheDocument();
  });

  it("clicking a subscription opens the modal scoped to that pattern's transactionIds", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PatternsTab transactions={txns} />);

    const card = screen.getByText("Netflix").closest("button");
    expect(card).not.toBeNull();
    await user.click(card!);

    const dialog = await screen.findByRole("dialog", { name: /Netflix/i });
    // All six Netflix charges in the modal.
    const rows = within(dialog).getAllByText("Netflix");
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(within(dialog).queryByText("Coffee Shop")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("One-Off Bodega")).not.toBeInTheDocument();
  });
});
