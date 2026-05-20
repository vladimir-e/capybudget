import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Category, Transaction } from "@capybudget/core";
import { MonthlyBudgetTab } from "./monthly-budget-tab";
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

// Category mutations module is brought in by `AssignedInput` editor;
// stub the hook so it doesn't try to hit a repository.
vi.mock("@/hooks/use-category-mutations", () => ({
  useSetCategoryAssigned: () => ({ mutate: vi.fn() }),
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

// Tracked = assigned !== null
const groceries = makeCategory({
  id: "cat-g",
  name: "Groceries",
  group: "Daily Living",
  assigned: 50000,
});
const rent = makeCategory({
  id: "cat-r",
  name: "Rent",
  group: "Fixed",
  assigned: 200000,
});
// Untracked = assigned === null
const subs = makeCategory({
  id: "cat-s",
  name: "Subscriptions",
  group: "Personal",
  assigned: null,
});

const may = (d: number) => new Date(2026, 4, d, 12, 0).toISOString();
const apr = (d: number) => new Date(2026, 3, d, 12, 0).toISOString();

const txns: Transaction[] = [
  // Tracked-category expenses in May
  makeTransaction({ id: "g1", accountId: acc.id, categoryId: groceries.id, type: "expense", amount: -1500, datetime: may(5), merchant: "Trader Joe's" }),
  makeTransaction({ id: "r1", accountId: acc.id, categoryId: rent.id, type: "expense", amount: -200000, datetime: may(1), merchant: "Landlord" }),
  // Untracked-category expense in May
  makeTransaction({ id: "s1", accountId: acc.id, categoryId: subs.id, type: "expense", amount: -1500, datetime: may(7), merchant: "Netflix" }),
  // Out-of-range tracked expense (April) — must not appear
  makeTransaction({ id: "old", accountId: acc.id, categoryId: groceries.id, type: "expense", amount: -700, datetime: apr(28), merchant: "Old Store" }),
];

const dateRange = { start: new Date(2026, 4, 1), end: new Date(2026, 5, 1) };

beforeEach(() => {
  mockAccounts = [acc];
  mockCategories = [groceries, rent, subs];
  mockAllTransactions = txns;
});

afterEach(() => {
  cleanup();
});

describe("MonthlyBudgetTab — KPI strip drilldowns", () => {
  it("clicking 'Spent (tracked)' opens the modal scoped to tracked-category expenses in the month", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MonthlyBudgetTab
        transactions={txns}
        categories={mockCategories}
        dateRange={dateRange}
      />,
    );

    // The KPI value is rendered as a drilldown link with the accessible
    // label `View Spent (tracked) transactions`.
    const link = screen.getByRole("button", { name: /view spent \(tracked\) transactions/i });
    await user.click(link);

    const dialog = await screen.findByRole("dialog", { name: /Spent \(tracked\)/i });
    // Both tracked expenses present (Groceries + Rent), Netflix (untracked)
    // and the out-of-range April expense absent.
    expect(within(dialog).getByText("Trader Joe's")).toBeInTheDocument();
    expect(within(dialog).getByText("Landlord")).toBeInTheDocument();
    expect(within(dialog).queryByText("Netflix")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Old Store")).not.toBeInTheDocument();
  });

  it("clicking 'Other Spending' opens the modal scoped to untracked-category expenses in the month", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MonthlyBudgetTab
        transactions={txns}
        categories={mockCategories}
        dateRange={dateRange}
      />,
    );

    const link = screen.getByRole("button", { name: /view other spending transactions/i });
    await user.click(link);

    const dialog = await screen.findByRole("dialog", { name: /Other Spending/i });
    expect(within(dialog).getByText("Netflix")).toBeInTheDocument();
    expect(within(dialog).queryByText("Trader Joe's")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Landlord")).not.toBeInTheDocument();
  });

  it("'Assigned' and 'Remaining' cards are display-only (no drilldown link)", () => {
    renderWithProviders(
      <MonthlyBudgetTab
        transactions={txns}
        categories={mockCategories}
        dateRange={dateRange}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /view assigned transactions/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /view remaining transactions/i }),
    ).not.toBeInTheDocument();
  });
});
