import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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

function renderBar(opts: { selectedIds: Set<string>; transactions: Transaction[]; accounts?: Account[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(budgetKeys.accounts(), opts.accounts ?? [RUB_ACCT, RUB_ACCT_2, IDR_ACCT]);
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

  it("on a mixed-currency selection, Move opens a modal with the warning and no account picker", async () => {
    const { user } = renderBar({
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", accountId: "acct-rub" }),
        txn({ id: "t2", accountId: "acct-idr" }), // different currency → mixed
      ],
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const moveItem = await screen.findByRole("menuitem", { name: /move to account/i });
    expect(moveItem).not.toHaveAttribute("aria-disabled", "true"); // clickable now
    await user.click(moveItem);

    // The modal explains the mix and offers no account picker.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/mixes currencies/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("option")).not.toBeInTheDocument();
  });
});

describe("BulkActionBar — single-currency budget", () => {
  it("omits the same-currency tip when no account is a different currency", async () => {
    const { user } = renderBar({
      accounts: [RUB_ACCT, RUB_ACCT_2], // one currency only — nothing to disable
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", accountId: "acct-rub" }),
        txn({ id: "t2", accountId: "acct-rub" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: /move to account/i }));

    // The account picker still renders so the move can happen...
    expect(await screen.findByRole("option", { name: "RUB Savings" })).toBeInTheDocument();
    // ...but the multi-currency caveat is absent — nothing is a different currency.
    expect(screen.queryByText(/same-currency/i)).not.toBeInTheDocument();
  });
});

describe("BulkActionBar — transfer-only selection", () => {
  it("offers only Change date; Move and Change merchant are hidden", async () => {
    const { user } = renderBar({
      selectedIds: new Set(["t1", "t2"]),
      transactions: [
        txn({ id: "t1", type: "transfer", transferPairId: "t2", merchant: "" }),
        txn({ id: "t2", type: "transfer", transferPairId: "t1", merchant: "" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: /change date/i })).toBeInTheDocument();
    // Move and merchant skip transfers, so they would be no-ops — not offered.
    expect(screen.queryByRole("menuitem", { name: /move to account/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /change merchant/i })).not.toBeInTheDocument();
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
