import { describe, expect, it } from "vitest";
import type { Transaction } from "@capybudget/core";
import { SEED_RATES } from "@capybudget/core";
import { generateScenarioData } from "./generator";
import { PROFILE_LIST } from "./profiles";
import type { DemoProfile } from "./profiles/types";
import { underwater } from "./profiles/underwater";
import { paycheckToPaycheck } from "./profiles/paycheck-to-paycheck";
import { noStress } from "./profiles/no-stress";

const NOW = new Date("2026-05-30T12:00:00");

function gen(profile = underwater, yearsBack = 1, seed = 1) {
  return generateScenarioData(profile, { now: NOW, yearsBack, seed });
}

/** Net worth at the end of the window, in the default currency: each flow valued
 *  at its stamped `fxRate` (mirroring `flowToDefault`), so foreign amounts roll
 *  up correctly and a cross-currency transfer's two legs net to ~0. Default and
 *  unstamped flows pass through at face value. With the demo's single seed table
 *  the stamped rate equals today's rate, so this also values foreign holdings. */
function netWorth(transactions: Transaction[]): number {
  return transactions.reduce(
    (sum, t) => sum + Math.round(t.amount * (t.fxRate ?? 1)),
    0,
  );
}

/** Opening net worth in the default currency: each account's opening balance is
 *  native to its currency, so value it at the seed rate before summing — a raw
 *  cent-sum would read a foreign opening (e.g. 40,000 ₸) as that many dollars. */
function openingNetWorth(profile: DemoProfile): number {
  const currencyByAccount = new Map(
    profile.accounts.map((a) => [a.id, a.currency]),
  );
  return Object.entries(profile.openingBalances).reduce((sum, [id, bal]) => {
    const currency = currencyByAccount.get(id) ?? "USD";
    const rate = SEED_RATES.rates.USD / SEED_RATES.rates[currency];
    return sum + Math.round(bal * rate);
  }, 0);
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
      // A same-currency pair mirrors exactly; a cross-currency pair carries two
      // independent native magnitudes that instead net to ~0 in the default.
      if ((t.fxRate ?? 1) === (mate!.fxRate ?? 1)) {
        expect(mate!.amount).toBe(-t.amount);
      } else {
        const usd = (x: Transaction) => x.amount * (x.fxRate ?? 1);
        expect(Math.abs(usd(t) + usd(mate!))).toBeLessThan(100);
      }
    }
  });

  describe("multi-currency", () => {
    // Each profile carries exactly one foreign account; the rest are USD.
    const foreignByProfile = [
      { profile: paycheckToPaycheck, accountId: "p2p-home", currency: "KZT" },
      { profile: underwater, accountId: "uw-bali", currency: "IDR" },
      { profile: noStress, accountId: "ns-japan", currency: "JPY" },
    ] as const;

    describe.each(foreignByProfile)(
      "$currency account in $profile.id",
      ({ profile, accountId, currency }) => {
        const seedRate = SEED_RATES.rates.USD / SEED_RATES.rates[currency];

        it("stamps the seed rate on every standalone foreign flow", () => {
          const { transactions } = generateScenarioData(profile, {
            now: NOW,
            yearsBack: 2,
            seed: 5,
          });
          const flows = transactions.filter(
            (t) => t.accountId === accountId && t.type !== "transfer",
          );
          expect(flows.length).toBeGreaterThan(0);
          for (const t of flows) {
            expect(t.fxRate).toBeCloseTo(seedRate, 12);
          }
        });

        it("leaves no foreign flow valued 1:1 (would skip the stamp)", () => {
          const { transactions } = generateScenarioData(profile, {
            now: NOW,
            yearsBack: 2,
            seed: 5,
          });
          const unstamped = transactions.filter(
            (t) => t.accountId === accountId && t.fxRate === undefined,
          );
          expect(unstamped).toEqual([]);
        });

        // The foreign balance must read like a real account across the window:
        // never negative at any day's close (a persistently-negative balance
        // reads as broken demo data), and — for an account meant to be spent
        // down — never ballooning far past its funding (a runaway balance
        // betrays a magnitude error, e.g. spends entered 100× too small). A
        // savings/asset account legitimately accumulates, so only the
        // non-negative floor applies to it. One band, across several seeds.
        it("keeps its native balance in a sane band at every day's close", () => {
          const opening = profile.openingBalances[accountId] ?? 0;
          const type = profile.accounts.find((a) => a.id === accountId)!.type;
          const accumulates = type === "savings" || type === "asset";
          for (const seed of [1, 5, 21, 42, 99]) {
            const { transactions } = generateScenarioData(profile, {
              now: NOW,
              yearsBack: 3,
              seed,
            });
            const rows = transactions.filter((t) => t.accountId === accountId);
            let balance = 0;
            let minClose = 0;
            let maxClose = opening;
            for (let i = 0; i < rows.length; i++) {
              balance += rows[i].amount;
              const lastOfDay =
                i === rows.length - 1 ||
                rows[i + 1].datetime.slice(0, 10) !==
                  rows[i].datetime.slice(0, 10);
              if (lastOfDay) {
                minClose = Math.min(minClose, balance);
                maxClose = Math.max(maxClose, balance);
              }
            }
            expect(minClose).toBeGreaterThanOrEqual(0);
            if (!accumulates) {
              expect(maxClose).toBeLessThanOrEqual(opening * 5);
            }
          }
        });
      },
    );

    it("USD (default-currency) transactions never carry an fxRate", () => {
      for (const { profile } of foreignByProfile) {
        const usdAccountIds = new Set(
          profile.accounts
            .filter((a) => a.currency === "USD")
            .map((a) => a.id),
        );
        const { transactions } = generateScenarioData(profile, {
          now: NOW,
          yearsBack: 2,
          seed: 5,
        });
        for (const t of transactions) {
          if (usdAccountIds.has(t.accountId)) {
            expect(t.fxRate).toBeUndefined();
          }
        }
      }
    });

    it("cross-currency transfer legs carry per-leg rates and net to ~0 in USD", () => {
      // The remittance (USD checking → KZT home) is a cross-currency pair.
      const { transactions } = generateScenarioData(paycheckToPaycheck, {
        now: NOW,
        yearsBack: 1,
        seed: 5,
      });
      const byId = new Map(transactions.map((t) => [t.id, t]));
      const remittances = transactions.filter(
        (t) => t.type === "transfer" && t.accountId === "p2p-home",
      );
      expect(remittances.length).toBeGreaterThan(0);

      for (const credit of remittances) {
        const debit = byId.get(credit.transferPairId)!;
        // From leg is USD (default) — no stamp; to leg is KZT — seed-stamped.
        expect(debit.accountId).toBe("p2p-checking");
        expect(debit.fxRate).toBeUndefined();
        expect(credit.fxRate).toBeCloseTo(
          SEED_RATES.rates.USD / SEED_RATES.rates.KZT,
          12,
        );
        // Native magnitudes differ, but the pair nets to ~0 in USD.
        expect(Math.abs(debit.amount)).not.toBe(Math.abs(credit.amount));
        const usd = (t: Transaction) => t.amount * (t.fxRate ?? 1);
        expect(Math.abs(usd(debit) + usd(credit))).toBeLessThan(100);
      }
    });
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

    it("emits integer-cent amounts", () => {
      const { transactions } = generateScenarioData(profile, {
        now: NOW,
        yearsBack: 1,
        seed: 5,
      });
      for (const t of transactions) {
        expect(Number.isInteger(t.amount)).toBe(true);
      }
    });

    // Physical cash can't go negative. Checked at each day's close because
    // intra-day ordering of a same-day withdrawal and spend is arbitrary.
    it("keeps cash accounts non-negative at every day's close", () => {
      const { accounts, transactions } = generateScenarioData(profile, {
        now: NOW,
        yearsBack: 3,
        seed: 5,
      });
      for (const account of accounts.filter((a) => a.type === "cash")) {
        const rows = transactions.filter((t) => t.accountId === account.id);
        let balance = 0;
        let minClose = 0;
        for (let i = 0; i < rows.length; i++) {
          balance += rows[i].amount;
          const lastOfDay =
            i === rows.length - 1 ||
            rows[i + 1].datetime.slice(0, 10) !== rows[i].datetime.slice(0, 10);
          if (lastOfDay) minClose = Math.min(minClose, balance);
        }
        expect(minClose).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it("fixed bills recur monthly at a stable amount", () => {
    const { transactions } = gen(noStress, 1, 11);
    const netflix = transactions
      .filter((t) => t.merchant === "Netflix Premium")
      .sort((a, b) => (a.datetime < b.datetime ? -1 : 1));

    expect(netflix.length).toBeGreaterThanOrEqual(2);
    const amounts = new Set(netflix.map((t) => t.amount));
    expect(amounts.size).toBe(1); // identical cents every month
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

  it("variable utility bills recur monthly within a tight band", () => {
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
      const opening = openingNetWorth(noStress);
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
      const opening = openingNetWorth(paycheckToPaycheck);
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
