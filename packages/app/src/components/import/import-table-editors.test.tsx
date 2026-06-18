import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrencyContext } from "@/contexts/currency-context";
import { makeImportTransaction } from "@capybudget/core/test-factories";
import { AmountEdit } from "./import-table-editors";

/** Render the import amount editor for a row under the given budget currency. */
function renderAmountEdit(currency: string, amount: number) {
  return render(
    <CurrencyContext.Provider value={currency}>
      <AmountEdit
        txn={makeImportTransaction({ amount, type: amount < 0 ? "expense" : "income" })}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    </CurrencyContext.Provider>,
  );
}

describe("AmountEdit — currency-aware prefix", () => {
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
});
