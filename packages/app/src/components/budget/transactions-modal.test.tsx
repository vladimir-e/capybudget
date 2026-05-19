import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach } from "vitest";
import type { Account, Category, Transaction } from "@capybudget/core";
import { TransactionsModal } from "./transactions-modal";
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

const account = makeAccount({ id: "acc-1", name: "Checking" });
const groceries = makeCategory({ id: "cat-groceries", name: "Groceries" });

const txns: Transaction[] = [
  makeTransaction({
    id: "t-1",
    accountId: account.id,
    categoryId: groceries.id,
    merchant: "Trader Joe's",
    amount: -1500,
  }),
];

beforeEach(() => {
  mockAccounts = [account];
  mockCategories = [groceries];
  mockAllTransactions = txns;
});

afterEach(() => {
  cleanup();
});

describe("TransactionsModal", () => {
  it("does not render content when closed", () => {
    renderWithProviders(
      <TransactionsModal
        open={false}
        onOpenChange={() => {}}
        transactions={txns}
        lockedFilters={{}}
        title="Groceries"
      />,
    );

    expect(screen.queryByRole("heading", { name: "Groceries" })).not.toBeInTheDocument();
  });

  it("renders content when open and passes title/subtitle through", () => {
    renderWithProviders(
      <TransactionsModal
        open={true}
        onOpenChange={() => {}}
        transactions={txns}
        lockedFilters={{ categoryId: groceries.id }}
        title="Groceries"
        subtitle="May 2026 · 1 transaction"
      />,
    );

    expect(screen.getByRole("heading", { name: "Groceries" })).toBeInTheDocument();
    expect(screen.getByText("May 2026 · 1 transaction")).toBeInTheDocument();
    expect(screen.getByText("Trader Joe's")).toBeInTheDocument();
  });

  it("invokes onOpenChange(false) when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    renderWithProviders(
      <TransactionsModal
        open={true}
        onOpenChange={onOpenChange}
        transactions={txns}
        lockedFilters={{}}
        title="Groceries"
      />,
    );

    await user.keyboard("{Escape}");
    // Base UI's onOpenChange signature is (open, eventInfo); we only care
    // that it was called with `false`.
    expect(onOpenChange).toHaveBeenCalled();
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
  });
});
