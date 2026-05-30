import { describe, expect, it } from "vitest";
import type { Transaction } from "@capybudget/core";
import { generateScenarioData } from "./generator";
import { PROFILE_LIST } from "./profiles";
import { underwater } from "./profiles/underwater";
import { paycheckToPaycheck } from "./profiles/paycheck-to-paycheck";
import { noStress } from "./profiles/no-stress";

const NOW = new Date("2026-05-30T12:00:00");

function gen(profile = underwater, yearsBack = 1, seed = 1) {
  return generateScenarioData(profile, { now: NOW, yearsBack, seed });
}

/** Net worth at the end of the window = sum of every account's signed balance,
 *  i.e. the sum of all transaction amounts (opening balances included, transfers
 *  net to zero across their pairs). */
function netWorth(transactions: Transaction[]): number {
  return transactions.reduce((sum, t) => sum + t.amount, 0);
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(b.slice(0, 10) + "T12:00:00").getTime() -
    new Date(a.slice(0, 10) + "T12:00:00").getTime();
  return Math.round(Math.abs(ms) / 86_400_000);
}

describe("generateScenarioData", () => {
  it("is deterministic for the same inputs", () => {
    const a = gen(underwater, 2, 42);
    const b = gen(underwater, 2, 42);
    expect(a).toEqual(b);
  });

  it("varies output when the seed changes", () => {
    const a = gen(underwater, 1, 1);
    const b = gen(underwater, 1, 2);
    expect(a.transactions).not.toEqual(b.transactions);
  });

  it("assigns unique transaction ids", () => {
    const { transactions } = gen(noStress, 1, 7);
    const ids = new Set(transactions.map((t) => t.id));
    expect(ids.size).toBe(transactions.length);
  });

  it("sorts transactions by datetime ascending", () => {
    const { transactions } = gen(noStress, 1, 7);
    for (let i = 1; i < transactions.length; i++) {
      expect(
        transactions[i - 1].datetime <= transactions[i].datetime,
      ).toBe(true);
    }
  });

  it("keeps every datetime within [now - yearsBack, now]", () => {
    const yearsBack = 2;
    const lower = new Date(NOW);
    lower.setFullYear(lower.getFullYear() - yearsBack);
    const lowerStr = lower.toISOString().slice(0, 10);
    const upperStr = NOW.toISOString().slice(0, 10);

    for (const profile of PROFILE_LIST) {
      const { transactions } = generateScenarioData(profile, {
        now: NOW,
        yearsBack,
        seed: 99,
      });
      for (const t of transactions) {
        const day = t.datetime.slice(0, 10);
        expect(day >= lowerStr).toBe(true);
        expect(day <= upperStr).toBe(true);
      }
    }
  });

  it("emits linked, balanced transfer pairs", () => {
    const { transactions } = gen(noStress, 1, 3);
    const transfers = transactions.filter((t) => t.type === "transfer");
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.length % 2).toBe(0);

    const byId = new Map(transactions.map((t) => [t.id, t]));
    for (const t of transfers) {
      const mate = byId.get(t.transferPairId);
      expect(mate).toBeDefined();
      expect(mate!.transferPairId).toBe(t.id);
      expect(mate!.amount).toBe(-t.amount);
    }
  });

  describe.each(PROFILE_LIST)("profile: $id", (profile) => {
    it("gives every non-archived category at least one transaction", () => {
      const { categories, transactions } = generateScenarioData(profile, {
        now: NOW,
        yearsBack: 3,
        seed: 5,
      });
      const used = new Set(transactions.map((t) => t.categoryId));
      const uncovered = categories
        .filter((c) => !c.archived)
        .filter((c) => !used.has(c.id));
      expect(uncovered.map((c) => c.name)).toEqual([]);
    });

    it("only references real account and category ids", () => {
      const { accounts, categories, transactions } = generateScenarioData(
        profile,
        { now: NOW, yearsBack: 1, seed: 5 },
      );
      const accountIds = new Set(accounts.map((a) => a.id));
      const categoryIds = new Set(categories.map((c) => c.id));
      for (const t of transactions) {
        expect(accountIds.has(t.accountId)).toBe(true);
        if (t.categoryId) expect(categoryIds.has(t.categoryId)).toBe(true);
      }
    });
  });

  it("produces a detectable monthly recurring series for fixed bills", () => {
    // Mirrors the detector's pass-1 contract (account + exact amount, monthly
    // cadence): a fixed bill must surface as a same-merchant, same-cents series
    // with a ~30-day median interval and at least two occurrences.
    const { transactions } = gen(noStress, 1, 11);
    const netflix = transactions
      .filter((t) => t.merchant === "Netflix Premium")
      .sort((a, b) => (a.datetime < b.datetime ? -1 : 1));

    expect(netflix.length).toBeGreaterThanOrEqual(2);
    const amounts = new Set(netflix.map((t) => t.amount));
    expect(amounts.size).toBe(1); // identical cents → pass-1 high confidence
    const accounts = new Set(netflix.map((t) => t.accountId));
    expect(accounts.size).toBe(1);

    const intervals: number[] = [];
    for (let i = 1; i < netflix.length; i++) {
      intervals.push(daysBetween(netflix[i - 1].datetime, netflix[i].datetime));
    }
    const median = [...intervals].sort((a, b) => a - b)[
      Math.floor(intervals.length / 2)
    ];
    expect(Math.abs(median - 30)).toBeLessThanOrEqual(3); // monthly tolerance
  });

  it("produces a detectable monthly series for variable utility bills", () => {
    // The detector's pass-2 contract (account + category, monthly, low count):
    // utilities recur monthly with small amount drift, staying near one per month.
    const { transactions, categories } = gen(noStress, 2, 13);
    const billsCat = categories.find((c) => c.name === "Bills & Utilities")!;
    const pge = transactions
      .filter((t) => t.merchant === "PG&E" && t.categoryId === billsCat.id)
      .sort((a, b) => (a.datetime < b.datetime ? -1 : 1));

    expect(pge.length).toBeGreaterThanOrEqual(3);
    const intervals: number[] = [];
    for (let i = 1; i < pge.length; i++) {
      intervals.push(daysBetween(pge[i - 1].datetime, pge[i].datetime));
    }
    const median = [...intervals].sort((a, b) => a - b)[
      Math.floor(intervals.length / 2)
    ];
    expect(Math.abs(median - 30)).toBeLessThanOrEqual(3);
    // amounts vary (so it reads real) but stay in a tight band
    const min = Math.min(...pge.map((t) => Math.abs(t.amount)));
    const max = Math.max(...pge.map((t) => Math.abs(t.amount)));
    expect(min).not.toBe(max);
    expect(max / min).toBeLessThan(1.6);
  });

  describe("per-scenario balance trajectory", () => {
    it("no-stress grows net worth over three years", () => {
      const opening = Object.values(noStress.openingBalances).reduce(
        (a, b) => a + b,
        0,
      );
      const { transactions } = generateScenarioData(noStress, {
        now: NOW,
        yearsBack: 3,
        seed: 21,
      });
      expect(netWorth(transactions)).toBeGreaterThan(opening);
    });

    it("underwater stays underwater with credit trending the wrong way", () => {
      const { accounts, transactions } = generateScenarioData(underwater, {
        now: NOW,
        yearsBack: 3,
        seed: 21,
      });
      const balances = new Map<string, number>();
      for (const t of transactions) {
        balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + t.amount);
      }
      // No savings/asset account exists, and liquid cash stays modest — the
      // scenario is precarious, not building wealth.
      const liquid = accounts
        .filter((a) => a.type === "savings" || a.type === "asset")
        .reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0);
      expect(liquid).toBeLessThan(500_00);

      // Net worth stays underwater across the window.
      expect(netWorth(transactions)).toBeLessThan(0);

      // The credit card balance ends deeper in the red than it opened —
      // everyday spend outpaces the minimum payments.
      const credit = accounts.find((a) => a.type === "credit_card")!;
      expect(balances.get(credit.id)!).toBeLessThan(
        underwater.openingBalances[credit.id],
      );
    });

    it("paycheck-to-paycheck ends near where it started", () => {
      const opening = Object.values(
        paycheckToPaycheck.openingBalances,
      ).reduce((a, b) => a + b, 0);
      const { transactions } = generateScenarioData(paycheckToPaycheck, {
        now: NOW,
        yearsBack: 3,
        seed: 21,
      });
      const ending = netWorth(transactions);
      // Thin drift either way — no meaningful wealth-building over three years.
      expect(Math.abs(ending - opening)).toBeLessThan(2_000_000);
    });
  });
});
