import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, createEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Category, Transaction } from "@capybudget/core";
import { TransactionList } from "./transaction-list";
import type { SortConfig } from "@/lib/filter-transactions";
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
  useIsMultiCurrency: () => false,
}));

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const account = makeAccount({ id: "acc-1", name: "Checking" });
const groceries = makeCategory({ id: "cat-groceries", name: "Groceries" });
const sort: SortConfig = { column: "date", direction: "desc" };

function makeTxns(n: number): Transaction[] {
  return Array.from({ length: n }, (_, i) =>
    makeTransaction({
      id: `t-${i}`,
      accountId: account.id,
      categoryId: groceries.id,
      merchant: `Merchant ${i}`,
      amount: -((i + 1) * 100),
      datetime: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    }),
  );
}

function rowOf(merchant: string): HTMLElement {
  return screen.getByText(merchant).closest("tr")!;
}

beforeEach(() => {
  mockAccounts = [account];
  mockCategories = [groceries];
  mockAllTransactions = [];
});

afterEach(() => {
  cleanup();
});

describe("TransactionList row context menu", () => {
  it("opens a row menu with Edit/Delete and suppresses the native menu when actions are provided", async () => {
    renderWithProviders(
      <TransactionList
        transactions={makeTxns(3)}
        showAccountColumn
        sort={sort}
        onSortChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    const event = createEvent.contextMenu(rowOf("Merchant 0"));
    fireEvent(rowOf("Merchant 0"), event);

    // Native menu is replaced by the app's menu.
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });

  it("leaves read-only rows unwrapped so the native menu is preserved", () => {
    renderWithProviders(
      <TransactionList
        transactions={makeTxns(3)}
        showAccountColumn
        sort={sort}
        onSortChange={() => {}}
      />,
    );

    // Rows still render…
    expect(screen.getByText("Merchant 0")).toBeInTheDocument();

    // …but a right-click opens no app menu and the native menu is left intact.
    const event = createEvent.contextMenu(rowOf("Merchant 0"));
    fireEvent(rowOf("Merchant 0"), event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });
});
