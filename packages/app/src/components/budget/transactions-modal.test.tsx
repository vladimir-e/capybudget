import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
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

    // Two headings carry the title: the visible `<h2>` inside
    // TransactionsBrowser and the screen-reader-only `<DialogTitle>` that
    // gives Base UI an `aria-labelledby` target. Both are intentional.
    const headings = screen.getAllByRole("heading", { name: "Groceries" });
    expect(headings.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("May 2026 · 1 transaction")).toBeInTheDocument();
    expect(screen.getByText("Trader Joe's")).toBeInTheDocument();
  });

  it("exposes an accessible name via DialogTitle so Base UI can label the popup", () => {
    renderWithProviders(
      <TransactionsModal
        open={true}
        onOpenChange={() => {}}
        transactions={txns}
        lockedFilters={{}}
        title="Groceries"
      />,
    );

    // The dialog role itself must carry the accessible name — Base UI
    // wires `aria-labelledby` to the rendered DialogTitle.
    expect(screen.getByRole("dialog", { name: "Groceries" })).toBeInTheDocument();
  });

  it("locks the popup to its natural height once measured, even as search shrinks the list", async () => {
    // JSDOM returns offsetHeight = 0 for every element. Stub the prototype
    // to return a fixed natural height so the measurement code has something
    // realistic to lock onto. Restore after the test.
    const MEASURED = 640;
    const original = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return MEASURED;
      },
    });

    try {
      // Need > 10 transactions to surface the search field; the bug being
      // tested is "modal shrinks under the cursor as the user types".
      const many: Transaction[] = Array.from({ length: 50 }, (_, i) =>
        makeTransaction({
          id: `m-${i}`,
          accountId: account.id,
          categoryId: groceries.id,
          merchant: `Merchant ${i}`,
          amount: -((i + 1) * 100),
        }),
      );
      mockAllTransactions = many;

      const user = userEvent.setup();
      renderWithProviders(
        <TransactionsModal
          open={true}
          onOpenChange={() => {}}
          transactions={many}
          lockedFilters={{}}
          title="All"
        />,
      );

      // Wait for the rAF inside the modal to fire and pin the height.
      await waitFor(() => {
        const dialog = screen.getByRole("dialog");
        expect(dialog.style.height).toBe(`${MEASURED}px`);
      });

      // Type a query that filters to ~zero or one row.
      const input = screen.getByLabelText(/search transactions/i);
      await user.type(input, "zzznoresults");

      // Height stays pinned — the shrinking list does not pull the modal up.
      const dialog = screen.getByRole("dialog");
      expect(dialog.style.height).toBe(`${MEASURED}px`);
    } finally {
      if (original) {
        Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", original);
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      }
    }
  });

  it("clears the locked height when closed so the next open re-measures", async () => {
    const MEASURED = 480;
    const original = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return MEASURED;
      },
    });

    try {
      const { rerender } = renderWithProviders(
        <TransactionsModal
          open={true}
          onOpenChange={() => {}}
          transactions={txns}
          lockedFilters={{}}
          title="Groceries"
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog").style.height).toBe(`${MEASURED}px`);
      });

      // Close → popup unmounts; the lock state should reset internally.
      // Re-open and verify we measure fresh (height applies again).
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <TransactionsModal
            open={false}
            onOpenChange={() => {}}
            transactions={txns}
            lockedFilters={{}}
            title="Groceries"
          />
        </QueryClientProvider>,
      );

      // Allow the layout-effect's reset to run.
      await act(async () => {
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      });

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <TransactionsModal
            open={true}
            onOpenChange={() => {}}
            transactions={txns}
            lockedFilters={{}}
            title="Groceries"
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog").style.height).toBe(`${MEASURED}px`);
      });
    } finally {
      if (original) {
        Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", original);
      } else {
        delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      }
    }
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
