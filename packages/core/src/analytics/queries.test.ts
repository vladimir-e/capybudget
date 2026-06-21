import { describe, it, expect } from "vitest";
import {
  getAccountBalance,
  getAccountsByGroup,
  getTransactionsForAccount,
  getNetWorth,
  getNetWorthBreakdown,
  resolveTransferPair,
} from "./queries";
import { IDENTITY_CONVERTER, createConverter } from "./converter";
import type { Account, Transaction } from "../entities/types";

// ── Test fixtures (self-contained, no external deps) ─────

const ACCOUNTS: Account[] = [
  { id: "acc-cash-01", name: "Cash Wallet", type: "cash", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-checking-01", name: "BofA Checking", type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-savings-01", name: "High Yield Savings", type: "savings", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-credit-01", name: "Chase Sapphire", type: "credit_card", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-loan-01", name: "Student Loan", type: "loan", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-crypto-01", name: "Coinbase", type: "crypto", archived: false, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z", currency: "USD" },
  { id: "acc-checking-old", name: "Old Wells Fargo", type: "checking", archived: true, excludeFromNetWorth: false, sortOrder: 0, createdAt: "2025-06-01T00:00:00.000Z", currency: "USD" },
];

const txn = (overrides: Partial<Transaction> & Pick<Transaction, "id" | "amount" | "accountId">): Transaction => ({
  datetime: "2026-02-01T00:00:00.000Z",
  type: "expense",
  categoryId: "",
  transferPairId: "",
  merchant: "",
  note: "",
  createdAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

const TRANSACTIONS: Transaction[] = [
  // Cash: 20000 - 3500 = 16500
  txn({ id: "txn-01", type: "income", amount: 20000, accountId: "acc-cash-01" }),
  txn({ id: "txn-02", amount: -3500, accountId: "acc-cash-01" }),
  // Credit card: -85000 - 8500 - 4200 - 1599 - 12000 - 7500 - 4999 + 50000 = -73798
  txn({ id: "txn-03", amount: -85000, accountId: "acc-credit-01" }),
  txn({ id: "txn-04", amount: -8500, accountId: "acc-credit-01" }),
  txn({ id: "txn-05", amount: -4200, accountId: "acc-credit-01" }),
  txn({ id: "txn-06", amount: -1599, accountId: "acc-credit-01" }),
  txn({ id: "txn-07", amount: -12000, accountId: "acc-credit-01" }),
  txn({ id: "txn-08", amount: -7500, accountId: "acc-credit-01" }),
  txn({ id: "txn-09", amount: -4999, accountId: "acc-credit-01" }),
  txn({ id: "txn-10", type: "transfer", amount: 50000, accountId: "acc-credit-01", transferPairId: "txn-11" }),
  // Checking: 500000
  txn({ id: "txn-11", type: "transfer", amount: -50000, accountId: "acc-checking-01", transferPairId: "txn-10" }),
  txn({ id: "txn-12", type: "income", amount: 500000, accountId: "acc-checking-01" }),
  // Savings: 100000
  txn({ id: "txn-13", type: "income", amount: 100000, accountId: "acc-savings-01" }),
  // Loan: -50000
  txn({ id: "txn-14", amount: -50000, accountId: "acc-loan-01" }),
];

describe("getAccountBalance", () => {
  it("sums all transaction amounts for an account", () => {
    const balance = getAccountBalance("acc-cash-01", TRANSACTIONS);
    // 20000 (opening) - 3500 (gas) = 16500
    expect(balance).toBe(16500);
  });

  it("returns 0 for an account with no transactions", () => {
    expect(getAccountBalance("nonexistent", TRANSACTIONS)).toBe(0);
  });

  it("handles credit card with negative opening + expenses + payment", () => {
    const balance = getAccountBalance("acc-credit-01", TRANSACTIONS);
    // -85000 - 8500 - 4200 - 1599 - 12000 - 7500 - 4999 + 50000 = -73798
    expect(balance).toBe(-73798);
  });
});

describe("getAccountsByGroup", () => {
  it("groups accounts by type in display order", () => {
    const groups = getAccountsByGroup(ACCOUNTS);
    const keys = [...groups.keys()];
    expect(keys).toEqual(["cash", "checking", "savings", "credit_card", "loan", "crypto"]);
  });

  it("excludes archived accounts", () => {
    const archived = [
      ...ACCOUNTS,
      { id: "arc-1", name: "Old", type: "checking" as const, archived: true, excludeFromNetWorth: false, sortOrder: 99, createdAt: "", currency: "USD" },
    ];
    const groups = getAccountsByGroup(archived);
    const checking = groups.get("checking")!;
    expect(checking.every((a) => !a.archived)).toBe(true);
  });
});

describe("getTransactionsForAccount", () => {
  it("returns all transactions when accountId is null", () => {
    expect(getTransactionsForAccount(null, TRANSACTIONS)).toBe(TRANSACTIONS);
  });

  it("filters to a specific account", () => {
    const txns = getTransactionsForAccount("acc-cash-01", TRANSACTIONS);
    expect(txns.every((t) => t.accountId === "acc-cash-01")).toBe(true);
    expect(txns.length).toBe(2);
  });
});

describe("getNetWorth", () => {
  it("sums non-archived account balances", () => {
    const netWorth = getNetWorth(ACCOUNTS, TRANSACTIONS);
    // Cash: 16500, Checking: 450000, Savings: 100000, Credit: -73798, Loan: -50000, Crypto: 0
    expect(netWorth).toBe(16500 + 450000 + 100000 + -73798 + -50000);
  });

  it("excludes accounts with excludeFromNetWorth=true", () => {
    const accounts = ACCOUNTS.map((a) =>
      a.id === "acc-loan-01" ? { ...a, excludeFromNetWorth: true } : a,
    );
    const netWorth = getNetWorth(accounts, TRANSACTIONS);
    // Loan (-50000) is now excluded → net worth goes up by 50000
    expect(netWorth).toBe(16500 + 450000 + 100000 + -73798);
  });

  it("excludes archived accounts even when excludeFromNetWorth=false", () => {
    // Archived alone is sufficient — the existing acc-checking-old is archived.
    // Sanity-check: flipping its excludeFromNetWorth doesn't change anything.
    const accounts = ACCOUNTS.map((a) =>
      a.id === "acc-checking-old" ? { ...a, excludeFromNetWorth: false } : a,
    );
    const netWorth = getNetWorth(accounts, TRANSACTIONS);
    expect(netWorth).toBe(16500 + 450000 + 100000 + -73798 + -50000);
  });
});

describe("getNetWorthBreakdown", () => {
  it("a single-currency budget: fxDelta is 0 and byAccount is empty", () => {
    const breakdown = getNetWorthBreakdown(ACCOUNTS, TRANSACTIONS);
    expect(breakdown.fxDelta).toBe(0);
    expect(breakdown.byAccount).toEqual([]);
  });

  it("spot reconciles with getNetWorth and with costBasis + fxDelta", () => {
    const breakdown = getNetWorthBreakdown(ACCOUNTS, TRANSACTIONS);
    expect(breakdown.spot).toBe(getNetWorth(ACCOUNTS, TRANSACTIONS));
    expect(breakdown.spot).toBe(breakdown.costBasis + breakdown.fxDelta);
  });

  it("an explicit identity converter matches the default arg", () => {
    expect(getNetWorthBreakdown(ACCOUNTS, TRANSACTIONS)).toEqual(
      getNetWorthBreakdown(ACCOUNTS, TRANSACTIONS, IDENTITY_CONVERTER),
    );
  });

  // The plan's worked example: default USD, a ruble account with +100,000 ₽
  // stamped at 0.016 ($1,600 cost), worth $1,100 spot today at 0.011 — a −$500
  // unrealized FX loss.
  describe("the ruble worked example (foreign account lights it up)", () => {
    const converter = createConverter(new Map([["RUB", 0.011]]), "USD");
    const rubAccount: Account = {
      id: "acc-rub", name: "Tinkoff", type: "checking", archived: false,
      excludeFromNetWorth: false, sortOrder: 1, createdAt: "2019-01-01T00:00:00.000Z",
      currency: "RUB",
    };
    const rubTxns: Transaction[] = [
      txn({ id: "r1", amount: 10_000_000, type: "income", accountId: "acc-rub", fxRate: 0.016 }),
    ];

    it("splits net worth into cost basis, spot, and the −$500 FX delta", () => {
      const breakdown = getNetWorthBreakdown([rubAccount], rubTxns, converter);
      expect(breakdown.costBasis).toBe(160_000); // 100k ₽ × 0.016
      expect(breakdown.spot).toBe(110_000); //      100k ₽ × 0.011
      expect(breakdown.fxDelta).toBe(-50_000);
    });

    it("reconciles: spot === costBasis + fxDelta === getNetWorth", () => {
      const breakdown = getNetWorthBreakdown([rubAccount], rubTxns, converter);
      expect(breakdown.spot).toBe(breakdown.costBasis + breakdown.fxDelta);
      expect(breakdown.spot).toBe(getNetWorth([rubAccount], rubTxns, converter));
    });

    it("reports the per-account delta for the foreign account", () => {
      const { byAccount } = getNetWorthBreakdown([rubAccount], rubTxns, converter);
      expect(byAccount).toEqual([
        { accountId: "acc-rub", costBasis: 160_000, spot: 110_000, fxDelta: -50_000 },
      ]);
    });

    it("a default-currency account alongside a foreign one stays out of byAccount", () => {
      const usdAccount: Account = {
        id: "acc-usd", name: "Checking", type: "checking", archived: false,
        excludeFromNetWorth: false, sortOrder: 0, createdAt: "2026-01-01T00:00:00.000Z",
        currency: "USD",
      };
      const usdTxns: Transaction[] = [
        txn({ id: "u1", amount: 500_00, type: "income", accountId: "acc-usd" }),
      ];
      const breakdown = getNetWorthBreakdown(
        [usdAccount, rubAccount], [...usdTxns, ...rubTxns], converter,
      );
      // Only the ruble account moves; USD cost === spot.
      expect(breakdown.byAccount.map((a) => a.accountId)).toEqual(["acc-rub"]);
      expect(breakdown.fxDelta).toBe(-50_000);
      expect(breakdown.spot).toBe(breakdown.costBasis + breakdown.fxDelta);
      expect(breakdown.spot).toBe(getNetWorth([usdAccount, rubAccount], [...usdTxns, ...rubTxns], converter));
    });

    it("excludes archived and excludeFromNetWorth accounts, matching getNetWorth", () => {
      const archived = { ...rubAccount, archived: true };
      expect(getNetWorthBreakdown([archived], rubTxns, converter).spot).toBe(
        getNetWorth([archived], rubTxns, converter),
      );
    });
  });
});

describe("resolveTransferPair", () => {
  const fromLeg: Transaction = {
    id: "tf-from",
    datetime: "2026-03-01T12:00:00.000Z",
    type: "transfer",
    amount: -25000,
    categoryId: "",
    accountId: "acc-checking",
    transferPairId: "tf-to",
    merchant: "",
    note: "",
    createdAt: "2026-03-01T00:00:00.000Z",
  };

  const toLeg: Transaction = {
    id: "tf-to",
    datetime: "2026-03-01T12:00:00.000Z",
    type: "transfer",
    amount: 25000,
    categoryId: "",
    accountId: "acc-savings",
    transferPairId: "tf-from",
    merchant: "",
    note: "",
    createdAt: "2026-03-01T00:00:00.000Z",
  };

  const allTxns = [fromLeg, toLeg];

  it("resolves outflow leg: txn is 'from', pair is 'to'", () => {
    const result = resolveTransferPair(fromLeg, allTxns);
    expect(result.fromAccountId).toBe("acc-checking");
    expect(result.toAccountId).toBe("acc-savings");
    expect(result.pairTransaction).toBe(toLeg);
  });

  it("resolves inflow leg: pair is 'from', txn is 'to'", () => {
    const result = resolveTransferPair(toLeg, allTxns);
    expect(result.fromAccountId).toBe("acc-checking");
    expect(result.toAccountId).toBe("acc-savings");
    expect(result.pairTransaction).toBe(fromLeg);
  });

  it("returns fallback for unpaired outflow (negative amount)", () => {
    const orphan: Transaction = {
      ...fromLeg,
      id: "orphan",
      transferPairId: "nonexistent",
    };
    const result = resolveTransferPair(orphan, allTxns);
    expect(result.fromAccountId).toBe("acc-checking");
    expect(result.toAccountId).toBe("");
    expect(result.pairTransaction).toBeUndefined();
  });

  it("returns fallback for unpaired inflow (positive amount)", () => {
    const orphan: Transaction = {
      ...toLeg,
      id: "orphan-inflow",
      transferPairId: "",
    };
    const result = resolveTransferPair(orphan, []);
    expect(result.fromAccountId).toBe("");
    expect(result.toAccountId).toBe("acc-savings");
    expect(result.pairTransaction).toBeUndefined();
  });
});
