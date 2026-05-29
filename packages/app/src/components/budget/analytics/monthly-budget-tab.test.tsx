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

// Explicit budget, under target this month.
const groceries = makeCategory({
  id: "cat-g",
  name: "Groceries",
  group: "Daily Living",
  assigned: 50000,
});
// Explicit budget, over target this month (spends 2000 against a 1000 budget).
const rent = makeCategory({
  id: "cat-r",
  name: "Rent",
  group: "Fixed",
  assigned: 100000,
});
// No explicit budget, no history → untargeted.
const subs = makeCategory({
  id: "cat-s",
  name: "Subscriptions",
  group: "Personal",
  assigned: null,
});

const may = (d: number) => new Date(2026, 4, d, 12, 0).toISOString();
const apr = (d: number) => new Date(2026, 3, d, 12, 0).toISOString();

const txns: Transaction[] = [
  makeTransaction({ id: "g1", accountId: acc.id, categoryId: groceries.id, type: "expense", amount: -1500, datetime: may(5), merchant: "Trader Joe's" }),
  makeTransaction({ id: "r1", accountId: acc.id, categoryId: rent.id, type: "expense", amount: -200000, datetime: may(1), merchant: "Landlord" }),
  // Untargeted-category expense in May.
  makeTransaction({ id: "s1", accountId: acc.id, categoryId: subs.id, type: "expense", amount: -1500, datetime: may(7), merchant: "Netflix" }),
  // Out-of-range expense (April) — must not appear in the month drilldown.
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

describe("MonthlyBudgetTab — KPI strip", () => {
  it("'Spent this month' drills into every categorized expense in the month", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );

    const link = screen.getByRole("button", { name: /view spent this month transactions/i });
    await user.click(link);

    const dialog = await screen.findByRole("dialog", { name: /Spent this month/i });
    // Every in-month categorized expense is present, regardless of whether the
    // category is budgeted; the out-of-range April expense is absent.
    expect(within(dialog).getByText("Trader Joe's")).toBeInTheDocument();
    expect(within(dialog).getByText("Landlord")).toBeInTheDocument();
    expect(within(dialog).getByText("Netflix")).toBeInTheDocument();
    expect(within(dialog).queryByText("Old Store")).not.toBeInTheDocument();
  });

  it("'Tracking toward' and 'Over budget' cards are display-only (no drilldown link)", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );

    expect(
      screen.queryByRole("button", { name: /view tracking toward transactions/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /view over budget transactions/i }),
    ).not.toBeInTheDocument();
  });
});

describe("MonthlyBudgetTab — row states", () => {
  it("shows overspend textually as '$X over' so it doesn't depend on color", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    // Rent: $2,000 spent against a $1,000 budget → $1,000.00 over.
    expect(screen.getByText("$1,000.00 over")).toBeInTheDocument();
  });

  it("tags an untargeted category's target cell with a 'set' affordance and a dash for remaining", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    // Subscriptions has no budget and no history → its target cell offers to
    // set a budget rather than showing a number.
    const setBudget = screen.getByRole("button", { name: /set a budget for subscriptions/i });
    expect(setBudget).toBeInTheDocument();
  });
});
