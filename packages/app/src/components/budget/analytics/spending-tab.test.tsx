import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Category, Transaction } from "@capybudget/core";
import { SpendingTab } from "./spending-tab";
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
const groceries = makeCategory({ id: "cat-g", name: "Groceries" });
const housing = makeCategory({ id: "cat-h", name: "Housing" });

const may = (d: number) => new Date(2026, 4, d, 12, 0).toISOString();

const txns: Transaction[] = [
  makeTransaction({ id: "g1", accountId: acc.id, categoryId: groceries.id, type: "expense", amount: -1500, datetime: may(5), merchant: "Trader Joe's" }),
  makeTransaction({ id: "g2", accountId: acc.id, categoryId: groceries.id, type: "expense", amount: -2300, datetime: may(10), merchant: "Whole Foods" }),
  makeTransaction({ id: "h1", accountId: acc.id, categoryId: housing.id, type: "expense", amount: -185000, datetime: may(1), merchant: "Landlord" }),
];

const dateRange = { start: new Date(2026, 4, 1), end: new Date(2026, 5, 1) };

beforeEach(() => {
  mockAccounts = [acc];
  mockCategories = [groceries, housing];
  mockAllTransactions = txns;
});

afterEach(() => {
  cleanup();
});

describe("SpendingTab — empty states", () => {
  it("shows the brand-new-budget copy when the budget has no transactions at all", () => {
    renderWithProviders(
      <SpendingTab
        transactions={[]}
        categories={[]}
        dateRange={dateRange}
        periodType="month"
        hasAnyTransactions={false}
      />,
    );

    // A brand-new budget gets the forward-looking copy, not the period-scoped
    // "no expenses in this period" — the empty period is the whole budget.
    expect(
      screen.getByText("This will be useful once you have more data."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No expenses in this period")).not.toBeInTheDocument();
  });
});

describe("SpendingTab — drilldown wiring", () => {
  it("clicking the category-list amount opens the modal with the same pre-filter as a pie-slice click", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SpendingTab
        transactions={txns}
        categories={mockCategories}
        dateRange={dateRange}
        periodType="month"
        hasAnyTransactions
      />,
    );

    // The breakdown list renders the amount as a drilldown link with the
    // accessible label `View <category> transactions`. Click the
    // Groceries amount.
    const amountLink = screen.getByRole("button", { name: /view groceries transactions/i });
    await user.click(amountLink);

    // Modal opens with the category's name as title and the matching
    // expense transactions visible — same shape the pie-slice handler
    // produces (both routes call `handleSliceClick` with `{ categoryId,
    // name }` and the current viewMode).
    const dialog = await screen.findByRole("dialog", { name: "Groceries" });
    // Both Groceries expense rows visible
    expect(within(dialog).getByText("Trader Joe's")).toBeInTheDocument();
    expect(within(dialog).getByText("Whole Foods")).toBeInTheDocument();
    // Housing expense filtered out
    expect(within(dialog).queryByText("Landlord")).not.toBeInTheDocument();
  });
});
