/**
 * The cardinal invariant: with no converter (or the identity converter) every
 * roll-up returns exactly what it returns today, and a converter with real
 * rates values flows by their stamp and holdings by today's rate. This proves
 * U1's wiring ahead of the U2–U4 data that lights it up.
 */
import { describe, it, expect } from "vitest";
import {
  getSpendingByCategory,
  getIncomeByCategory,
  getCashFlow,
  getTopMerchants,
  getCategoryTrends,
  getCategoryHistoricalStats,
  getNetWorthOverTime,
  type DateRange,
} from "./analytics";
import { getAccountBalance, getNetWorth } from "./queries";
import { groupTransactions } from "./group";
import { IDENTITY_CONVERTER, createConverter } from "./converter";
import type { Account, Category, Transaction } from "../entities/types";

const range: DateRange = {
  start: new Date(2026, 0, 1),
  end: new Date(2026, 3, 1),
};

const categories: Category[] = [
  { id: "cat-groc", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 0, assigned: null },
  { id: "cat-pay", name: "Paycheck", group: "Income", archived: false, sortOrder: 1, assigned: null },
];

const accounts: Account[] = [
  { id: "acc-usd", name: "USD Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z" },
];

const txn = (
  o: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "accountId">,
): Transaction => ({
  datetime: "2026-02-15T12:00:00.000Z",
  type: "expense",
  categoryId: "cat-groc",
  transferPairId: "",
  merchant: "Store",
  note: "",
  createdAt: "2026-02-15T00:00:00.000Z",
  ...o,
});

const txns: Transaction[] = [
  txn({ id: "t1", amount: -5000, accountId: "acc-usd", merchant: "Whole Foods" }),
  txn({ id: "t2", amount: -3000, accountId: "acc-usd", merchant: "Trader Joe's" }),
  txn({ id: "t3", amount: 200_000, accountId: "acc-usd", type: "income", categoryId: "cat-pay", merchant: "Employer" }),
];

// ── Identity: no converter == identity converter == today's behavior ─────────

describe("identity invariant — single-currency budgets are byte-identical", () => {
  it("getAccountBalance: default arg matches the identity converter", () => {
    expect(getAccountBalance("acc-usd", txns)).toBe(
      getAccountBalance("acc-usd", txns, IDENTITY_CONVERTER),
    );
    expect(getAccountBalance("acc-usd", txns)).toBe(192_000);
  });

  it("getNetWorth: default arg matches the identity converter", () => {
    expect(getNetWorth(accounts, txns)).toBe(
      getNetWorth(accounts, txns, IDENTITY_CONVERTER),
    );
    expect(getNetWorth(accounts, txns)).toBe(192_000);
  });

  it("flow roll-ups: default arg deep-equals the identity converter", () => {
    expect(getSpendingByCategory(txns, categories)).toEqual(
      getSpendingByCategory(txns, categories, IDENTITY_CONVERTER),
    );
    expect(getIncomeByCategory(txns, categories)).toEqual(
      getIncomeByCategory(txns, categories, IDENTITY_CONVERTER),
    );
    expect(getCashFlow(txns, range)).toEqual(
      getCashFlow(txns, range, IDENTITY_CONVERTER),
    );
    expect(getTopMerchants(txns)).toEqual(
      getTopMerchants(txns, 15, IDENTITY_CONVERTER),
    );
    expect(getCategoryTrends(txns, categories, range)).toEqual(
      getCategoryTrends(txns, categories, range, undefined, IDENTITY_CONVERTER),
    );
    expect(getCategoryHistoricalStats(txns, categories, range)).toEqual(
      getCategoryHistoricalStats(txns, categories, range, "trailing3", IDENTITY_CONVERTER),
    );
    expect(getNetWorthOverTime(accounts, txns, range)).toEqual(
      getNetWorthOverTime(accounts, txns, range, undefined, IDENTITY_CONVERTER),
    );
  });

  it("groupTransactions: absent converter deep-equals the identity converter", () => {
    const opts = { groupBy: ["category" as const], metrics: ["sum" as const, "avg" as const] };
    expect(groupTransactions(txns, opts, { accounts, categories })).toEqual(
      groupTransactions(txns, opts, { accounts, categories, converter: IDENTITY_CONVERTER }),
    );
  });
});

// ── Wiring: foreign data converts by the right rate ──────────────────────────

describe("conversion wiring — flows by stamp, holdings by today", () => {
  // Default USD; a ruble account whose income stamped at 0.016 but whose
  // balance today is worth 0.011.
  const converter = createConverter(new Map([["RUB", 0.011]]), "USD");

  const rubAccount: Account = {
    id: "acc-rub", name: "Tinkoff", type: "checking", archived: false,
    excludeFromNetWorth: false, sortOrder: 1, createdAt: "2019-01-01T00:00:00.000Z",
    currency: "RUB",
  };

  // +100_000 ₽ income in Feb, stamped at 0.016.
  const rubTxns: Transaction[] = [
    txn({
      id: "r1", amount: 10_000_000, type: "income", categoryId: "cat-pay",
      accountId: "acc-rub", merchant: "RU Employer", fxRate: 0.016,
    }),
  ];

  it("holding (getAccountBalance) values the balance at today's rate", () => {
    // 100_000 ₽ × 0.011 = $1,100
    expect(getAccountBalance("acc-rub", rubTxns, converter, "RUB")).toBe(110_000);
  });

  it("holding (getNetWorth) reads the account's currency at today's rate", () => {
    expect(getNetWorth([rubAccount], rubTxns, converter)).toBe(110_000);
  });

  it("flow (getCashFlow) values income at the stamped rate", () => {
    // 100_000 ₽ × 0.016 = $1,600
    const feb = getCashFlow(rubTxns, range, converter).find((p) => p.month === "Feb 2026");
    expect(feb?.income).toBe(160_000);
  });

  it("flow (getIncomeByCategory) values income at the stamped rate", () => {
    const paycheck = getIncomeByCategory(rubTxns, categories, converter)
      .find((b) => b.categoryId === "cat-pay");
    expect(paycheck?.total).toBe(160_000);
  });

  it("flow (getNetWorthOverTime) accumulates the stamped cost basis, not spot", () => {
    const points = getNetWorthOverTime([rubAccount], rubTxns, range, undefined, converter);
    const last = points[points.length - 1];
    // Cost basis = $1,600 (the stamp), distinct from the $1,100 holding above.
    expect(last.netWorth).toBe(160_000);
  });

  it("flow (groupTransactions) sums amounts at the stamped rate", () => {
    const expenseRub: Transaction[] = [
      txn({ id: "e1", amount: -5000_00, accountId: "acc-rub", fxRate: 0.011, merchant: "Pyaterochka" }),
    ];
    const [group] = groupTransactions(
      expenseRub,
      { groupBy: ["merchant"], metrics: ["sum"] },
      { accounts: [rubAccount], categories, converter },
    );
    // -500_000 cents × 0.011 = -5_500 cents
    expect(group.sum).toBe(Math.round(-500_000 * 0.011));
  });

  it("flow (getTopMerchants) ranks by converted spend", () => {
    const expenseRub: Transaction[] = [
      txn({ id: "e1", amount: -500_000, accountId: "acc-rub", fxRate: 0.011, merchant: "Pyaterochka" }),
    ];
    const [top] = getTopMerchants(expenseRub, 15, converter);
    expect(top.merchant).toBe("Pyaterochka");
    expect(top.total).toBe(Math.round(500_000 * 0.011));
  });

  it("the spot holding and the cost-basis flow diverge — the FX delta is real", () => {
    const holding = getNetWorth([rubAccount], rubTxns, converter);
    const costBasis = getNetWorthOverTime([rubAccount], rubTxns, range, undefined, converter);
    const lastCost = costBasis[costBasis.length - 1].netWorth;
    expect(holding).toBe(110_000);
    expect(lastCost).toBe(160_000);
    expect(holding - lastCost).toBe(-50_000);
  });
});
