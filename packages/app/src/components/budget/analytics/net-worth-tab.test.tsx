import { describe, it, expect, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { formatDefaultsFor, type CurrencySettings, type DateRange } from "@capybudget/core";
import { makeAccount, makeTransaction } from "@/test/factories";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { NetWorthTab } from "./net-worth-tab";

// THE invariant: a USD-only budget renders zero FX-delta UI. The worked example
// (a ruble account whose stamp ≠ today's rate) lights up the callout with the
// right sign and magnitude — but only while the chart window reaches the
// present, since spot is a today's-rate number.

function renderTab(currencies: Record<string, CurrencySettings> | undefined, ui: ReactNode) {
  const config: CurrencyConfig = {
    currency: "USD",
    currencies,
    ...formatDefaultsFor("USD"),
  };
  return render(
    <CurrencyContext.Provider value={config}>{ui}</CurrencyContext.Provider>,
  );
}

// A window whose end is in the future, so the callout's today-statement is
// honest regardless of the wall clock when the suite runs.
const currentRange: DateRange = {
  start: new Date(new Date().getFullYear() - 1, 0, 1),
  end: new Date(new Date().getFullYear() + 1, 0, 1),
};

const RUB_CURRENCIES: Record<string, CurrencySettings> = {
  USD: formatDefaultsFor("USD"),
  RUB: { ...formatDefaultsFor("RUB"), rate: 0.011, rateSource: "manual" },
};

// Default USD, a ruble account: +100,000 ₽ stamped at 0.016 ($1,600 cost),
// worth $1,100 today at a manual 0.011 rate — a −$500 unrealized FX loss.
const rubAccount = makeAccount({ id: "acc-rub", name: "Tinkoff", currency: "RUB" });
const rubTxns = [
  makeTransaction({
    id: "r1", accountId: "acc-rub", type: "income", amount: 10_000_000,
    fxRate: 0.016, datetime: `${new Date().getFullYear()}-01-15T12:00:00.000Z`,
  }),
];

afterEach(() => cleanup());

describe("NetWorthTab — FX delta callout", () => {
  it("(THE invariant) a USD-only budget renders no FX-delta UI", () => {
    const usd = makeAccount({ id: "acc-usd", name: "Checking", currency: "USD" });
    const txns = [
      makeTransaction({ id: "u1", accountId: "acc-usd", type: "income", amount: 500_00, datetime: `${new Date().getFullYear()}-01-15T12:00:00.000Z` }),
    ];
    renderTab({ USD: formatDefaultsFor("USD") }, (
      <NetWorthTab accounts={[usd]} transactions={txns} dateRange={currentRange} hasAnyTransactions />
    ));
    expect(screen.queryByText("Unrealized FX")).not.toBeInTheDocument();
  });

  it("lights up for a foreign account with the −$500 worked example", () => {
    renderTab(RUB_CURRENCIES, (
      <NetWorthTab accounts={[rubAccount]} transactions={rubTxns} dateRange={currentRange} hasAnyTransactions />
    ));

    expect(screen.getByText("Unrealized FX")).toBeInTheDocument();
    // The −$500 loss, rendered with the minus glyph in the expense token.
    expect(screen.getByText("−$500.00")).toBeInTheDocument();
    // The relationship: current value (spot) = cost basis (chart endpoint).
    expect(
      screen.getByText("Current value $1,100.00 = cost basis $1,600.00"),
    ).toBeInTheDocument();
  });

  it("hides the callout when scrubbed to a historical range (spot is a today statement)", () => {
    // A fully-past window: even with a foreign account, the chart endpoint is an
    // as-of-then number, so a today's-rate callout under it would be incoherent.
    const pastRange: DateRange = { start: new Date(2019, 0, 1), end: new Date(2020, 0, 1) };
    renderTab(RUB_CURRENCIES, (
      <NetWorthTab accounts={[rubAccount]} transactions={rubTxns} dateRange={pastRange} hasAnyTransactions />
    ));
    expect(screen.queryByText("Unrealized FX")).not.toBeInTheDocument();
  });
});
