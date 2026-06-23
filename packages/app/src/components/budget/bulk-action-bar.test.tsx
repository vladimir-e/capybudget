import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  formatDefaultsFor,
  type Account,
  type CurrencySettings,
  type Transaction,
} from "@capybudget/core";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { BulkActionBar } from "./bulk-action-bar";

afterEach(cleanup);

// The bar reads accounts/categories through query hooks; these guards exercise
// the disabled-target logic, which never touches the repo.
const stubRepo = {} as unknown as Parameters<typeof RepositoryProvider>[0]["value"];

function makeAcct(overrides: Partial<Account>): Account {
  return {
    id: "acct",
    name: "Account",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    currency: "RUB",
    ...overrides,
  };
}

const RUB_ACCT = makeAcct({ id: "acct-rub", name: "RUB Checking", currency: "RUB" });
const RUB_ACCT_2 = makeAcct({ id: "acct-rub2", name: "RUB Savings", currency: "RUB", type: "savings", sortOrder: 2 });
const IDR_ACCT = makeAcct({ id: "acct-idr", name: "IDR Wallet", currency: "IDR", type: "cash", sortOrder: 3 });

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t",
    datetime: "2026-06-01T10:00:00.000",
    type: "expense",
    amount: -10_000,
    categoryId: "",
    accountId: "acct-rub",
    transferPairId: "",
    merchant: "X",
    note: "",
    createdAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

function renderBar(opts: { selectedIds: Set<string>; transactions: Transaction[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(budgetKeys.accounts(), [RUB_ACCT, RUB_ACCT_2, IDR_ACCT]);
  client.setQueryData(budgetKeys.categories(), []);

  const currencies: Record<string, CurrencySettings> = {
    RUB: formatDefaultsFor("RUB"),
    IDR: formatDefaultsFor("IDR"),
  };
  const config: CurrencyConfig = { currency: "RUB", currencies, ...formatDefaultsFor("RUB") };

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        RepositoryProvider,
        { value: stubRepo },
        createElement(CurrencyContext.Provider, { value: config }, children),
      ),
    );

  render(
    createElement(BulkActionBar, {
      selectedIds: opts.selectedIds,
      transactions: opts.transactions,
      onClear: () => {},
    }),
    { wrapper },
  );

  return { user: userEvent.setup() };
}

describe("BulkActionBar — same-currency-only move", () => {
  it("disables different-currency accounts in the move modal, keeps same-currency ones enabled", async () => {
    const { user } = renderBar({
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", accountId: "acct-rub" }),
        txn({ id: "t2", accountId: "acct-rub" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /move to account/i }));

    // The grouped account picker opens inside the modal (defaultOpen).
    const idrOption = await screen.findByRole("option", { name: "IDR Wallet" });
    const rubOption = screen.getByRole("option", { name: "RUB Savings" });
    expect(idrOption).toHaveAttribute("aria-disabled", "true"); // different currency
    expect(rubOption).not.toHaveAttribute("aria-disabled", "true"); // same currency
  });

  it("disables the Move action when the selection mixes currencies", async () => {
    const { user } = renderBar({
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", accountId: "acct-rub" }),
        txn({ id: "t2", accountId: "acct-idr" }), // different currency → mixed
      ],
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const moveItem = await screen.findByRole("menuitem", { name: /move to account/i });
    expect(moveItem).toHaveAttribute("aria-disabled", "true");
  });
});

describe("BulkActionBar — selection total currency", () => {
  it("totals a single-currency foreign selection in that currency", () => {
    renderBar({
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", accountId: "acct-idr", amount: -10_000 }),
        txn({ id: "t2", accountId: "acct-idr", amount: -10_000 }),
      ],
    });

    // Native IDR sum (-20,000 minor units → Rp200), shown with the IDR symbol,
    // not the default ₽.
    expect(screen.getByText("-Rp200")).toBeInTheDocument();
    expect(screen.queryByText(/₽/)).not.toBeInTheDocument();
  });

  it("totals a mixed-currency selection in the budget default", () => {
    renderBar({
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", accountId: "acct-rub", amount: -10_000 }),
        txn({ id: "t2", accountId: "acct-idr", amount: -10_000 }),
      ],
    });

    // No single native currency → the rollup converts into the default (₽),
    // and never reads as IDR (Rp).
    const total = screen.getByText(/₽/);
    expect(total).toBeInTheDocument();
    expect(total.textContent).not.toContain("Rp");
  });
});
