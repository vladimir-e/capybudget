import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CurrencyContext } from "@/contexts/currency-context";
import { makeTransaction } from "@/test/factories";
import { InlineEditCell } from "./inline-edit-cells";

/** Render the amount editor for a transaction under the given budget currency. */
function renderAmountEdit(currency: string, amount: number) {
  return render(
    <CurrencyContext.Provider value={currency}>
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
});
