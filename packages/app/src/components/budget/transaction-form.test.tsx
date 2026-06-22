import { describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  formatDefaultsFor,
  currencySymbol,
  type Account,
  type CurrencySettings,
  type Transaction,
  type TransactionFormData,
} from "@capybudget/core";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { TransactionForm } from "./transaction-form";

afterEach(cleanup);

// The form reads accounts/transactions through query hooks and never touches
// the repo directly, so a stub satisfies the provider contract.
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

/** Mount the form under a RUB-default budget with the given seed data. */
function renderForm(opts: {
  accounts: Account[];
  transactions?: Transaction[];
  editingTransaction?: Transaction | null;
}) {
  const onSave = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(budgetKeys.accounts(), opts.accounts);
  client.setQueryData(budgetKeys.transactions(), opts.transactions ?? []);
  client.setQueryData(budgetKeys.categories(), []);

  const currencies: Record<string, CurrencySettings> = {
    RUB: formatDefaultsFor("RUB"),
    IDR: formatDefaultsFor("IDR"),
    USD: formatDefaultsFor("USD"),
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
    createElement(TransactionForm, {
      editingTransaction: opts.editingTransaction,
      onSave,
      // Panel mode keeps the form expanded so the entry fields render without an
      // editing transaction (the symbol cases mount a fresh expense form).
      onDismiss: () => {},
    }),
    { wrapper },
  );

  return { onSave, user: userEvent.setup() };
}

// ── Cross-currency transfer accounts (Vlad's repro) ─────────────
const RUB_ACCT = makeAcct({ id: "acct-rub", name: "RUB Checking", currency: "RUB" });
const IDR_ACCT = makeAcct({ id: "acct-idr", name: "IDR Wallet", currency: "IDR", sortOrder: 2 });

// A 10,000 ₽ → 1,758,000 IDR transfer. Outflow on the RUB side, inflow on IDR.
const OUTFLOW_LEG: Transaction = {
  id: "leg-out",
  datetime: "2026-06-01T10:00:00.000",
  type: "transfer",
  amount: -1_000_000, // 10,000.00 ₽ out
  categoryId: "",
  accountId: "acct-rub",
  transferPairId: "leg-in",
  merchant: "",
  note: "",
  createdAt: "2026-06-01T10:00:00.000Z",
};
const INFLOW_LEG: Transaction = {
  ...OUTFLOW_LEG,
  id: "leg-in",
  amount: 175_800_000, // 1,758,000.00 IDR in
  accountId: "acct-idr",
  transferPairId: "leg-out",
};

const transferSeed = {
  accounts: [RUB_ACCT, IDR_ACCT],
  transactions: [OUTFLOW_LEG, INFLOW_LEG],
};

describe("TransactionForm — cross-currency transfer edit", () => {
  // The headline regression: opening the editor from the inflow (IDR) leg must
  // still seed the from-amount from the RUB outflow leg, not the IDR magnitude.
  it("seeds `amount` from the outflow leg when opened from the inflow row", async () => {
    const { onSave, user } = renderForm({
      ...transferSeed,
      editingTransaction: INFLOW_LEG,
    });

    const [amountInput, receivedInput] = screen.getAllByPlaceholderText("0.00");
    // From-amount shows the RUB outflow magnitude, never the IDR inflow's.
    expect(amountInput).toHaveValue("10000.00");
    expect(receivedInput).toHaveValue("1758000.00");

    // Change only the received amount, exactly as Vlad did.
    await user.clear(receivedInput);
    await user.type(receivedInput, "1800000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0] as TransactionFormData;
    expect(payload.amount).toBe(1_000_000); // RUB outflow, untouched
    expect(payload.toAmount).toBe(180_000_000); // new IDR received amount
  });

  it("seeds the same legs when opened from the outflow row", async () => {
    const { onSave, user } = renderForm({
      ...transferSeed,
      editingTransaction: OUTFLOW_LEG,
    });

    const [amountInput, receivedInput] = screen.getAllByPlaceholderText("0.00");
    expect(amountInput).toHaveValue("10000.00");
    expect(receivedInput).toHaveValue("1758000.00");

    await user.click(screen.getByRole("button", { name: "Save" }));

    const payload = onSave.mock.calls[0][0] as TransactionFormData;
    expect(payload.amount).toBe(1_000_000);
    expect(payload.toAmount).toBe(175_800_000);
  });
});

describe("TransactionForm — entry symbol follows the account currency", () => {
  it("shows the foreign account's symbol for an expense into it", () => {
    const usd = makeAcct({ id: "acct-usd", name: "USD Account", currency: "USD" });
    renderForm({ accounts: [usd] });

    // Single active account auto-selects, so the entry symbol is USD's.
    expect(screen.getByText(currencySymbol("USD"))).toBeInTheDocument();
    expect(screen.queryByText(currencySymbol("RUB"))).not.toBeInTheDocument();
  });

  it("shows the default symbol for an expense into a default-currency account", () => {
    const rub = makeAcct({ id: "acct-rub", name: "RUB Account", currency: "RUB" });
    renderForm({ accounts: [rub] });

    expect(screen.getByText(currencySymbol("RUB"))).toBeInTheDocument();
  });
});
