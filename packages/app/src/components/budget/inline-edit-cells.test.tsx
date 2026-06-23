import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { formatDefaultsFor } from "@capybudget/core";
import { CurrencyContext } from "@/contexts/currency-context";
import { makeTransaction, makeAccount } from "@/test/factories";
import { InlineEditCell } from "./inline-edit-cells";

function renderAmountEdit(currency: string, amount: number) {
  return render(
    <CurrencyContext.Provider value={{ currency, ...formatDefaultsFor(currency) }}>
      <InlineEditCell
        txn={makeTransaction({ amount, type: amount < 0 ? "expense" : "income" })}
        column="amount"
        accounts={[]}
        categories={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    </CurrencyContext.Provider>,
  );
}

describe("AccountEditCell — same-currency-only move", () => {
  it("disables different-currency accounts and keeps same-currency ones enabled", async () => {
    const accounts = [
      makeAccount({ id: "acct-rub", name: "RUB Checking", currency: "RUB", type: "checking" }),
      makeAccount({ id: "acct-rub2", name: "RUB Savings", currency: "RUB", type: "savings", sortOrder: 2 }),
      makeAccount({ id: "acct-idr", name: "IDR Wallet", currency: "IDR", type: "cash", sortOrder: 3 }),
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          CurrencyContext.Provider,
          { value: { currency: "RUB", ...formatDefaultsFor("RUB") } },
          createElement(InlineEditCell, {
            txn: makeTransaction({ accountId: "acct-rub", type: "expense" }),
            column: "account",
            accounts,
            categories: [],
            onSave: vi.fn(),
            onCancel: vi.fn(),
          }),
        ),
      ),
    );

    // The cell opens its picker on mount (defaultOpen).
    const idrOption = await screen.findByRole("option", { name: "IDR Wallet" });
    const rubOption = screen.getByRole("option", { name: "RUB Savings" });
    expect(idrOption).toHaveAttribute("aria-disabled", "true");
    expect(rubOption).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("AmountEditCell — currency-aware prefix", () => {
  it("renders the budget's symbol, not a hardcoded $, for a non-USD budget", () => {
    renderAmountEdit("EUR", 5000);
    expect(screen.getByText("€")).toBeInTheDocument();
    expect(screen.queryByText("$")).toBeNull();
  });

  it("prefixes a negative amount with the budget symbol", () => {
    renderAmountEdit("EUR", -5000);
    expect(screen.getByText("-€")).toBeInTheDocument();
    expect(screen.queryByText("-$")).toBeNull();
  });

  it("trails the symbol for a symbol-after budget, sign leading", () => {
    renderAmountEdit("RUB", -5000);
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("₽")).toBeInTheDocument();
    expect(screen.queryByText("-₽")).toBeNull();
  });
});
