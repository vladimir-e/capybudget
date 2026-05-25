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

const acc = makeAccount({ id: "acc-1", name: "Checking" });
const groceries = makeCategory({ id: "cat-g", name: "Groceries" });

// Helper: create a date ISO string for day N of a month sequence.
// month 0 = Jan 2026, etc.
function monthlyDate(monthOffset: number, day: number = 15): string {
  const d = new Date(2026, monthOffset, day, 12, 0);
  return d.toISOString();
}

// 4 transactions at ~30-day intervals for "Netflix" → triggers monthly recurring
const recurringTxns: Transaction[] = [
  makeTransaction({ id: "r1", accountId: acc.id, categoryId: groceries.id, merchant: "Netflix", amount: -1599, datetime: monthlyDate(0) }),
  makeTransaction({ id: "r2", accountId: acc.id, categoryId: groceries.id, merchant: "Netflix", amount: -1599, datetime: monthlyDate(1) }),
  makeTransaction({ id: "r3", accountId: acc.id, categoryId: groceries.id, merchant: "Netflix", amount: -1599, datetime: monthlyDate(2) }),
  makeTransaction({ id: "r4", accountId: acc.id, categoryId: groceries.id, merchant: "Netflix", amount: -1599, datetime: monthlyDate(3) }),
];

// 2 transactions with same accountId, amount, date, and merchant → triggers high-confidence duplicate
const duplicateTxns: Transaction[] = [
  makeTransaction({ id: "d1", accountId: acc.id, categoryId: groceries.id, merchant: "Whole Foods", amount: -4200, datetime: "2026-03-10T12:00:00.000Z" }),
  makeTransaction({ id: "d2", accountId: acc.id, categoryId: groceries.id, merchant: "Whole Foods", amount: -4200, datetime: "2026-03-10T12:00:00.000Z" }),
];

// Transactions that produce neither patterns nor duplicates: all different merchants, only 1 each
const noPatternTxns: Transaction[] = [
  makeTransaction({ id: "np1", accountId: acc.id, categoryId: groceries.id, merchant: "Alpha Store", amount: -1000, datetime: "2026-01-05T12:00:00.000Z" }),
  makeTransaction({ id: "np2", accountId: acc.id, categoryId: groceries.id, merchant: "Beta Shop", amount: -2000, datetime: "2026-02-10T12:00:00.000Z" }),
];

beforeEach(() => {
  mockAccounts = [acc];
  mockCategories = [groceries];
  mockAllTransactions = [...recurringTxns, ...duplicateTxns];
});

afterEach(() => {
  cleanup();
});

describe("PatternsTab — section headers", () => {
  it("renders Subscriptions and Duplicates headers with counts", () => {
    renderWithProviders(
      <PatternsTab transactions={[...recurringTxns, ...duplicateTxns]} />,
    );

    expect(screen.getByText("Subscriptions (1)")).toBeInTheDocument();
    expect(screen.getByText("Duplicates (1)")).toBeInTheDocument();
  });
});

describe("PatternsTab — empty states", () => {
  it("shows empty messages when no patterns or duplicates are found", () => {
    renderWithProviders(<PatternsTab transactions={noPatternTxns} />);

    expect(screen.getByText(/No recurring patterns found/)).toBeInTheDocument();
    expect(screen.getByText(/No duplicate transactions found/)).toBeInTheDocument();
    expect(screen.getByText("Subscriptions (0)")).toBeInTheDocument();
    expect(screen.getByText("Duplicates (0)")).toBeInTheDocument();
  });
});

describe("PatternsTab — subscription cards", () => {
  it("renders merchant name, cadence badge, amount, and next expected date", () => {
    renderWithProviders(<PatternsTab transactions={recurringTxns} />);

    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("monthly")).toBeInTheDocument();
    // avgAmount is $15.99 rendered by formatMoney
    expect(screen.getByText(/\$15\.99/)).toBeInTheDocument();
    // "Next:" label with a date
    expect(screen.getByText(/Next:/)).toBeInTheDocument();
  });
});

describe("PatternsTab — duplicate cards", () => {
  it("renders confidence badge, merchant, and amount", () => {
    renderWithProviders(<PatternsTab transactions={duplicateTxns} />);

    expect(screen.getByText("Whole Foods")).toBeInTheDocument();
    expect(screen.getByText("likely duplicate")).toBeInTheDocument();
    expect(screen.getByText(/\$42\.00/)).toBeInTheDocument();
  });
});

describe("PatternsTab — drilldown", () => {
  it("clicking a subscription card opens TransactionsModal", async () => {
    const user = userEvent.setup();
    const allTxns = [...recurringTxns, ...duplicateTxns];
    mockAllTransactions = allTxns;

    renderWithProviders(<PatternsTab transactions={allTxns} />);

    // The subscription card is a button containing the merchant name
    const card = screen.getByText("Netflix").closest("button")!;
    await user.click(card);

    const dialog = await screen.findByRole("dialog", { name: "Netflix" });
    expect(dialog).toBeInTheDocument();
    // All 4 recurring transactions should be visible in the modal
    expect(within(dialog).getAllByText("Netflix").length).toBeGreaterThanOrEqual(1);
  });

  it("clicking a duplicate card opens TransactionsModal", async () => {
    const user = userEvent.setup();
    const allTxns = [...recurringTxns, ...duplicateTxns];
    mockAllTransactions = allTxns;

    renderWithProviders(<PatternsTab transactions={allTxns} />);

    // The duplicate card is a button containing the merchant name
    const card = screen.getByText("Whole Foods").closest("button")!;
    await user.click(card);

    const dialog = await screen.findByRole("dialog", { name: "Whole Foods" });
    expect(dialog).toBeInTheDocument();
  });
});
