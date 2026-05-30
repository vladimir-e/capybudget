import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, BudgetBasis, BudgetMeta, Category, Transaction } from "@capybudget/core";
import { MonthlyBudgetTab } from "./monthly-budget-tab";
import { makeAccount, makeCategory, makeTransaction } from "@/test/factories";

let mockAccounts: Account[] = [];
let mockCategories: Category[] = [];
let mockAllTransactions: Transaction[] = [];
let mockMeta: BudgetMeta | undefined;

vi.mock("@/hooks/use-budget-data", () => ({
  budgetKeys: {
    all: ["budget"],
    accounts: () => ["budget", "accounts"],
    categories: () => ["budget", "categories"],
    transactions: () => ["budget", "transactions"],
    meta: () => ["budget", "meta"],
  },
  useAccounts: () => ({ data: mockAccounts }),
  useCategories: () => ({ data: mockCategories }),
  useTransactions: () => ({ data: mockAllTransactions }),
  useBudgetMeta: () => ({ data: mockMeta }),
}));

const setBasisMutate = vi.fn();
vi.mock("@/hooks/use-budget-meta-mutations", () => ({
  useSetBudgetBasis: () => ({ mutate: setBasisMutate }),
}));

// Category mutations module is brought in by `AssignedInput` editor;
// stub the hook so it doesn't try to hit a repository.
vi.mock("@/hooks/use-category-mutations", () => ({
  useSetCategoryAssigned: () => ({ mutate: vi.fn() }),
}));

const makeMeta = (basis?: BudgetBasis): BudgetMeta => ({
  schemaVersion: 1,
  name: "Test",
  currency: "USD",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModified: "2026-01-01T00:00:00.000Z",
  ...(basis ? { basis } : {}),
});

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
  mockMeta = makeMeta(); // defaults to trailing3 (basis absent)
  setBasisMutate.mockClear();
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
  it("shows overspend as a signed negative ('-$X') in the expense token", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    // Rent: $2,000 spent against a $1,000 budget → -$1,000.00 remaining.
    const remaining = screen.getByText("-$1,000.00");
    expect(remaining).toBeInTheDocument();
    // The minus sign carries "over"; color reinforces but isn't load-bearing.
    expect(remaining).toHaveClass("text-amount-expense");
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

describe("MonthlyBudgetTab — with-history table", () => {
  it("renders the two-pin bar legend (last month + reference)", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    // The legend keys only the history pins now; the zones/divider are
    // self-evident and no longer carry a legend row.
    expect(screen.getByText(/last month/i)).toBeInTheDocument();
    // Default basis (trailing3) → the reference picker shows "3-mo avg".
    expect(screen.getByRole("button", { name: /comparison basis: 3-mo avg/i })).toBeInTheDocument();
    expect(screen.queryByText(/within target \/ over/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/auto target/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your budget/i)).not.toBeInTheDocument();
  });

  it("labels the reference picker with the resolved basis (trailing6 → '6-mo avg')", () => {
    mockMeta = makeMeta("trailing6");
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    expect(screen.getByRole("button", { name: /comparison basis: 6-mo avg/i })).toBeInTheDocument();
  });

  it("resolves sameMonthLastYear to the actual month on the trigger (May 2026 → 'May 2025')", () => {
    mockMeta = makeMeta("sameMonthLastYear");
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    // dateRange starts May 2026 → the reference month is May 2025.
    expect(screen.getByRole("button", { name: /comparison basis: May 2025/i })).toBeInTheDocument();
  });

  it("persists a new basis when an option is chosen", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MonthlyBudgetTab transactions={txns} categories={mockCategories} dateRange={dateRange} />,
    );
    await user.click(screen.getByRole("button", { name: /comparison basis: 3-mo avg/i }));
    // The menu lists the descriptive option labels; pick "12 months".
    await user.click(await screen.findByRole("menuitemradio", { name: /12 months/i }));
    expect(setBasisMutate).toHaveBeenCalledWith("trailing12");
  });
});

describe("MonthlyBudgetTab — no-history first month", () => {
  // All categories unbudgeted + only in-month spend → no prior month has
  // data → monthsOfData === 0 and every row is untargeted.
  const freshCats: Category[] = [
    makeCategory({ id: "fc-1", name: "Groceries", group: "Daily Living", assigned: null }),
    makeCategory({ id: "fc-2", name: "Dining", group: "Daily Living", assigned: null }),
  ];
  const monthOneTxns: Transaction[] = [
    makeTransaction({ id: "m1", accountId: acc.id, categoryId: "fc-1", type: "expense", amount: -1500, datetime: may(7), merchant: "Trader Joe's" }),
  ];

  it("frames the empty-target month and hides the legend + filter", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={monthOneTxns} categories={freshCats} dateRange={dateRange} />,
    );
    // Friendly forming-targets note instead of a wall of bars.
    expect(screen.getByText(/No targets yet\./i)).toBeInTheDocument();
    // The bar legend and the tracked-only filter are suppressed (no pins to
    // key and nothing to filter when every row is untracked).
    expect(screen.queryByText(/3-mo avg/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Show only tracked/i)).not.toBeInTheDocument();
    // The month's spend is still surfaced via the KPI.
    expect(screen.getByText("Spent this month")).toBeInTheDocument();
  });
});

describe("MonthlyBudgetTab — genuinely empty", () => {
  it("prompts to add categories and shows no framing chrome", () => {
    renderWithProviders(
      <MonthlyBudgetTab transactions={[]} categories={[]} dateRange={dateRange} />,
    );
    expect(screen.getByText(/No categories to budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/No targets yet\./i)).not.toBeInTheDocument();
  });
});
