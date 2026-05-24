import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach } from "vitest";
import type { Account, Category, Transaction } from "@capybudget/core";
import { TransactionsBrowser } from "./transactions-browser";
import { makeAccount, makeCategory, makeTransaction } from "@/test/factories";

// ── Mock the data hooks. The list itself reads accounts/categories from
// React Query; for unit tests we serve them synchronously so the tree
// renders without an in-memory repo. ──
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

const account = makeAccount({ id: "acc-1", name: "Checking" });
const groceries = makeCategory({ id: "cat-groceries", name: "Groceries" });
const housing = makeCategory({ id: "cat-housing", name: "Housing" });

function makeTxns(n: number, base: Partial<Transaction> = {}): Transaction[] {
  return Array.from({ length: n }, (_, i) =>
    makeTransaction({
      id: `t-${i}`,
      accountId: account.id,
      categoryId: groceries.id,
      merchant: `Merchant ${i}`,
      amount: -((i + 1) * 100),
      datetime: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
      ...base,
    }),
  );
}

beforeEach(() => {
  mockAccounts = [account];
  mockCategories = [groceries, housing];
  mockAllTransactions = [];
});

afterEach(() => {
  cleanup();
});

describe("TransactionsBrowser", () => {
  it("renders title and subtitle", () => {
    renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(3)}
        lockedFilters={{ categoryId: groceries.id }}
        title="Groceries"
        subtitle="May 2026 · 3 transactions"
      />,
    );

    expect(screen.getByRole("heading", { name: "Groceries" })).toBeInTheDocument();
    expect(screen.getByText("May 2026 · 3 transactions")).toBeInTheDocument();
  });

  it("renders a chip for each locked filter", () => {
    // `to` is exclusive per the LockedFilters contract — Jun 1 means
    // "through end of May". The chip should subtract one day for display.
    // Build dates in local TZ (not "2026-05-31" which parses as UTC and can
    // render as the previous day in negative-offset zones).
    const from = new Date(2026, 4, 1);
    const to = new Date(2026, 5, 1);

    renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(1)}
        lockedFilters={{
          categoryId: groceries.id,
          dateRange: { from, to },
        }}
        title="Groceries"
      />,
    );

    // "Groceries" appears as the header, the category chip, and inside the
    // transaction row's category cell — at least 2 occurrences (header + chip).
    expect(screen.getAllByText("Groceries").length).toBeGreaterThanOrEqual(2);
    // The chip displays the inclusive range "May 1 – May 31", not the
    // exclusive "Jun 1" end.
    const matches = screen.queryAllByText((content) =>
      content.includes("May 1, 2026") && content.includes("May 31, 2026"),
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // No "Jun 1" anywhere — that would mean the chip leaked the exclusive
    // end into the visible range.
    expect(screen.queryByText(/Jun 1, 2026/)).not.toBeInTheDocument();
  });

  it("renders the merchant chip for a merchant filter, and falls back to 'Unknown' for empty", () => {
    const { rerender } = renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(1)}
        lockedFilters={{ merchant: "Trader Joe's" }}
        title="Trader Joe's"
      />,
    );
    // Two occurrences: header + chip
    expect(screen.getAllByText("Trader Joe's").length).toBeGreaterThanOrEqual(2);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TransactionsBrowser
          transactions={makeTxns(1)}
          lockedFilters={{ merchant: "" }}
          title="Unknown"
        />
      </QueryClientProvider>,
    );
    // Header "Unknown" + chip "Unknown"
    expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(2);
  });

  it("renders all transaction rows when no search applied", () => {
    renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(5)}
        lockedFilters={{}}
        title="All"
      />,
    );

    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`Merchant ${i}`)).toBeInTheDocument();
    }
  });

  it("hides search input when transactions.length <= 10", () => {
    renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(10)}
        lockedFilters={{}}
        title="Ten"
      />,
    );
    expect(screen.queryByLabelText(/search transactions/i)).not.toBeInTheDocument();
  });

  it("shows search input when transactions.length > 10", () => {
    renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(11)}
        lockedFilters={{}}
        title="Eleven"
      />,
    );
    expect(screen.getByLabelText(/search transactions/i)).toBeInTheDocument();
  });

  it("filters by merchant substring (case-insensitive)", async () => {
    const user = userEvent.setup();
    const txns = [
      ...makeTxns(10),
      makeTransaction({
        id: "special",
        accountId: account.id,
        categoryId: groceries.id,
        merchant: "Trader Joe's",
        amount: -1500,
        datetime: "2026-05-15T12:00:00.000Z",
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser
        transactions={txns}
        lockedFilters={{}}
        title="All"
      />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "trader");

    expect(screen.getByText("Trader Joe's")).toBeInTheDocument();
    expect(screen.queryByText("Merchant 0")).not.toBeInTheDocument();
  });

  it("matches the synthetic 'Uncategorized' label when typed into search", async () => {
    const user = userEvent.setup();
    const txns = [
      ...makeTxns(10, { categoryId: groceries.id }),
      makeTransaction({
        id: "uncat",
        accountId: account.id,
        categoryId: "", // synthetic Uncategorized
        merchant: "Mystery Charge",
        amount: -999,
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser transactions={txns} lockedFilters={{}} title="All" />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "uncategorized");

    expect(screen.getByText("Mystery Charge")).toBeInTheDocument();
    expect(screen.queryByText("Merchant 0")).not.toBeInTheDocument();
  });

  it("filters by category name", async () => {
    const user = userEvent.setup();
    const txns = [
      ...makeTxns(10, { categoryId: groceries.id }),
      makeTransaction({
        id: "rent",
        accountId: account.id,
        categoryId: housing.id,
        merchant: "Landlord",
        amount: -185000,
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser transactions={txns} lockedFilters={{}} title="All" />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "housing");

    expect(screen.getByText("Landlord")).toBeInTheDocument();
    expect(screen.queryByText("Merchant 0")).not.toBeInTheDocument();
  });

  it("filters by account name (case-insensitive substring)", async () => {
    const user = userEvent.setup();
    const appleCard = makeAccount({ id: "acc-apple", name: "Apple Card" });
    mockAccounts = [account, appleCard];

    const txns = [
      ...makeTxns(10),
      makeTransaction({
        id: "apple-1",
        accountId: appleCard.id,
        categoryId: groceries.id,
        merchant: "Whole Foods",
        amount: -2500,
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser transactions={txns} lockedFilters={{}} title="All" />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "apple");

    // Account name matches even though the merchant string is "Whole Foods"
    expect(screen.getByText("Whole Foods")).toBeInTheDocument();
    expect(screen.queryByText("Merchant 0")).not.toBeInTheDocument();
  });

  it("filters by note", async () => {
    const user = userEvent.setup();
    const txns = [
      ...makeTxns(10),
      makeTransaction({
        id: "noted",
        accountId: account.id,
        categoryId: groceries.id,
        merchant: "Bodega",
        note: "midnight snack",
        amount: -750,
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser transactions={txns} lockedFilters={{}} title="All" />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "midnight");

    expect(screen.getByText("Bodega")).toBeInTheDocument();
  });

  it("filters by formatted amount (with comma)", async () => {
    const user = userEvent.setup();
    const txns = [
      ...makeTxns(10),
      makeTransaction({
        id: "big",
        accountId: account.id,
        categoryId: groceries.id,
        merchant: "Big Spend",
        amount: -185000, // $1,850.00
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser transactions={txns} lockedFilters={{}} title="All" />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "1,850");

    expect(screen.getByText("Big Spend")).toBeInTheDocument();
    expect(screen.queryByText("Merchant 0")).not.toBeInTheDocument();
  });

  it("filters by raw amount (no formatting)", async () => {
    const user = userEvent.setup();
    const txns = [
      ...makeTxns(10),
      makeTransaction({
        id: "big",
        accountId: account.id,
        categoryId: groceries.id,
        merchant: "Big Spend",
        amount: -185000,
      }),
    ];

    renderWithProviders(
      <TransactionsBrowser transactions={txns} lockedFilters={{}} title="All" />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "1850");

    expect(screen.getByText("Big Spend")).toBeInTheDocument();
  });

  it("shows empty state when search yields zero", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <TransactionsBrowser
        transactions={makeTxns(11)}
        lockedFilters={{}}
        title="All"
      />,
    );

    const input = screen.getByLabelText(/search transactions/i);
    await user.type(input, "zzznoresults");

    const empty = screen.getByText(/no transactions match/i);
    expect(empty).toBeInTheDocument();
    expect(within(empty).getByText("zzznoresults")).toBeInTheDocument();
  });

  it("locked.transactionIds restricts the list to the selected IDs", () => {
    const txns = makeTxns(5);
    renderWithProviders(
      <TransactionsBrowser
        transactions={txns}
        lockedFilters={{ transactionIds: new Set(["t-1", "t-3"]) }}
        title="Selection"
      />,
    );

    expect(screen.getByText("Merchant 1")).toBeInTheDocument();
    expect(screen.getByText("Merchant 3")).toBeInTheDocument();
    expect(screen.queryByText("Merchant 0")).not.toBeInTheDocument();
    expect(screen.queryByText("Merchant 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Merchant 4")).not.toBeInTheDocument();
  });

  it("locked.amountRange filters by cents (inclusive bounds)", () => {
    const txns = [
      makeTransaction({ id: "small", accountId: account.id, categoryId: groceries.id, merchant: "Small", amount: -500 }),
      makeTransaction({ id: "mid", accountId: account.id, categoryId: groceries.id, merchant: "Mid", amount: -2500 }),
      makeTransaction({ id: "big", accountId: account.id, categoryId: groceries.id, merchant: "Big", amount: -15000 }),
    ];
    renderWithProviders(
      <TransactionsBrowser
        transactions={txns}
        lockedFilters={{ amountRange: { min: -5000, max: -1000 } }}
        title="Mid-range"
      />,
    );
    expect(screen.getByText("Mid")).toBeInTheDocument();
    expect(screen.queryByText("Small")).not.toBeInTheDocument();
    expect(screen.queryByText("Big")).not.toBeInTheDocument();
  });

  it("locked.type filters to a single transaction type", () => {
    const txns = [
      makeTransaction({ id: "inc", type: "income", accountId: account.id, merchant: "Paycheck", amount: 100000 }),
      makeTransaction({ id: "exp", type: "expense", accountId: account.id, categoryId: groceries.id, merchant: "Whole Foods", amount: -2500 }),
    ];
    renderWithProviders(
      <TransactionsBrowser
        transactions={txns}
        lockedFilters={{ type: "income" }}
        title="Income"
      />,
    );
    expect(screen.getByText("Paycheck")).toBeInTheDocument();
    expect(screen.queryByText("Whole Foods")).not.toBeInTheDocument();
  });

  it("renders an expense-range chip as ascending magnitudes with an Expense prefix", () => {
    renderWithProviders(
      <TransactionsBrowser
        transactions={[]}
        lockedFilters={{ amountRange: { min: -5000, max: -1000 } }}
        title="Mid expenses"
      />,
    );
    // Chip reads "Expense $10.00 – $50.00", not "-$50.00 – -$10.00".
    expect(screen.getByText(/Expense\s+\$10\.00\s+–\s+\$50\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/-\$50\.00\s+–\s+-\$10\.00/)).not.toBeInTheDocument();
  });
});
