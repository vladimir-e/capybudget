import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import {
  formatDefaultsFor,
  type Account,
  type CurrencySettings,
  type Transaction,
  type TransactionFormData,
} from "@capybudget/core";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useUpdateTransaction } from "./use-transaction-mutations";

// A EUR→RUB transfer under a USD default: neither leg is the default, so the
// stored stamps are the only record of the rate this transfer executed at —
// re-deriving on an unrelated edit would lose them (`stampTransferRates` falls
// back to today's seed for both legs when neither side is the default).
const EUR_ACCT: Account = {
  id: "acct-eur",
  name: "EUR account",
  type: "checking",
  archived: false,
  excludeFromNetWorth: false,
  sortOrder: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  currency: "EUR",
};
const RUB_ACCT: Account = { ...EUR_ACCT, id: "acct-rub", name: "RUB account", currency: "RUB", sortOrder: 2 };

// Stamped the day the transfer happened, deliberately off today's seed so a
// re-rate would visibly move them.
const FROM_RATE = 1.05; // 1 EUR in USD back then
const TO_RATE = 0.016; // 1 RUB in USD back then

const FROM_LEG: Transaction = {
  id: "leg-from",
  datetime: "2024-06-01T10:00:00.000",
  type: "transfer",
  amount: -10_000, // 100.00 € out
  categoryId: "",
  accountId: "acct-eur",
  transferPairId: "leg-to",
  merchant: "",
  note: "rent",
  createdAt: "2024-06-01T10:00:00.000Z",
  fxRate: FROM_RATE,
};
const TO_LEG: Transaction = {
  ...FROM_LEG,
  id: "leg-to",
  amount: 1_000_000, // 10,000.00 ₽ in
  accountId: "acct-rub",
  transferPairId: "leg-from",
  fxRate: TO_RATE,
};

function setup() {
  const saved: Transaction[][] = [];
  const repo = {
    saveTransactions: vi.fn(async (next: Transaction[]) => {
      saved.push(next);
    }),
    saveAccounts: vi.fn(async () => {}),
    saveCategories: vi.fn(async () => {}),
  } as unknown as Parameters<typeof RepositoryProvider>[0]["value"];

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(budgetKeys.accounts(), [EUR_ACCT, RUB_ACCT]);
  client.setQueryData(budgetKeys.transactions(), [FROM_LEG, TO_LEG]);

  const currencies: Record<string, CurrencySettings> = {
    USD: formatDefaultsFor("USD"),
    EUR: formatDefaultsFor("EUR"),
    RUB: formatDefaultsFor("RUB"),
  };
  const config: CurrencyConfig = { currency: "USD", currencies, ...formatDefaultsFor("USD") };

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        RepositoryProvider,
        { value: repo },
        createElement(CurrencyContext.Provider, { value: config }, children),
      ),
    );

  return { client, repo, saved, wrapper };
}

// The form resolves accountId=from (outflow), toAccountId=to (inflow).
const baseForm: TransactionFormData = {
  id: "leg-from",
  type: "transfer",
  amount: 10_000,
  categoryId: "",
  accountId: "acct-eur",
  toAccountId: "acct-rub",
  toAmount: 1_000_000,
  date: "2024-06-01",
  merchant: "",
  note: "rent",
};

describe("useUpdateTransaction — both-foreign transfer rate preservation", () => {
  it("a note-only edit leaves both legs' amounts AND rates unchanged", async () => {
    const { saved, wrapper } = setup();
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...baseForm, note: "rent — updated" });
    });

    const next = saved.at(-1)!;
    const from = next.find((t) => t.id === "leg-from")!;
    const to = next.find((t) => t.id === "leg-to")!;

    // Rates survive verbatim — no re-rate to today.
    expect(from.fxRate).toBe(FROM_RATE);
    expect(to.fxRate).toBe(TO_RATE);
    // Amounts untouched.
    expect(from.amount).toBe(-10_000);
    expect(to.amount).toBe(1_000_000);
    // The actual edit applied.
    expect(from.note).toBe("rent — updated");
    expect(to.note).toBe("rent — updated");
  });

  it("a from-amount change re-derives both legs' rates", async () => {
    const { saved, wrapper } = setup();
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...baseForm, amount: 20_000 });
    });

    const next = saved.at(-1)!;
    const from = next.find((t) => t.id === "leg-from")!;
    const to = next.find((t) => t.id === "leg-to")!;

    // Shape changed → re-stamped at today's resolved rates, which differ from
    // the historical stamps.
    expect(from.fxRate).not.toBe(FROM_RATE);
    expect(to.fxRate).not.toBe(TO_RATE);
    expect(from.amount).toBe(-20_000);
  });

  it("a destination change re-derives both legs' rates", async () => {
    const { client, saved, wrapper } = setup();
    // Add a second RUB-side account to retarget the inflow leg.
    client.setQueryData(budgetKeys.accounts(), [
      EUR_ACCT,
      RUB_ACCT,
      { ...RUB_ACCT, id: "acct-rub2", name: "RUB account 2", sortOrder: 3 },
    ]);
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...baseForm, toAccountId: "acct-rub2" });
    });

    const next = saved.at(-1)!;
    const to = next.find((t) => t.id === "leg-to")!;
    expect(to.accountId).toBe("acct-rub2");
    expect(to.fxRate).not.toBe(TO_RATE);
  });

  it("a received-amount change re-stamps both legs at resolver rates that do NOT net to zero", async () => {
    // Editing only the received toAmount is a shape change → re-derive. Since
    // neither leg is the default (USD), stampTransferRates stamps each leg's OWN
    // resolver rate (EUR→USD, RUB→USD) — it does NOT derive a bank rate from the
    // two amounts. So the legs do NOT net to ~0 in the default; the residual is a
    // genuine FX spread. This is the intended both-foreign edit behavior.
    const { saved, wrapper } = setup();
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper });

    await act(async () => {
      // Received 10,500.00 ₽ instead of 10,000.00 ₽ (a different settlement).
      await result.current.mutateAsync({ ...baseForm, toAmount: 1_050_000 });
    });

    const next = saved.at(-1)!;
    const from = next.find((t) => t.id === "leg-from")!;
    const to = next.find((t) => t.id === "leg-to")!;

    // Leg amounts update to the edited values.
    expect(from.amount).toBe(-10_000); // outflow unchanged
    expect(to.amount).toBe(1_050_000); // inflow is the new received amount

    // Both re-stamped at today's resolver rates, off the historical stamps.
    expect(from.fxRate).not.toBe(FROM_RATE);
    expect(to.fxRate).not.toBe(TO_RATE);
    // Crucially NOT a derived bank rate: a netting rate would be toRate such that
    // -fromAmount × fromRate + toAmount × toRate ≈ 0. The resolver rate is the
    // currency's own →default rate, independent of the counter-leg's amount.
    expect(to.fxRate).not.toBe((from.amount / to.amount) * (from.fxRate ?? 1));
    // The legs deliberately do NOT net to ~0 — a real FX spread, not conservation.
    const net = from.amount * (from.fxRate ?? 1) + to.amount * (to.fxRate ?? 1);
    expect(Math.abs(net)).toBeGreaterThan(1);
  });
});

// A plain EUR flow stamped the day it happened, deliberately off today's seed
// (1/0.92 ≈ 1.087) so a re-rate would visibly move it.
const PLAIN_RATE = 1.05; // 1 EUR in USD back then
const PLAIN_FLOW: Transaction = {
  id: "flow-1",
  datetime: "2024-06-01T10:00:00.000",
  type: "expense",
  amount: -10_000, // 100.00 € out
  categoryId: "cat-1",
  accountId: "acct-eur",
  transferPairId: "",
  merchant: "Café",
  note: "",
  createdAt: "2024-06-01T10:00:00.000Z",
  fxRate: PLAIN_RATE,
};

const plainForm: TransactionFormData = {
  id: "flow-1",
  type: "expense",
  amount: 10_000,
  categoryId: "cat-1",
  accountId: "acct-eur",
  date: "2024-06-01",
  merchant: "Café",
  note: "",
};

function setupPlain() {
  const saved: Transaction[][] = [];
  const repo = {
    saveTransactions: vi.fn(async (next: Transaction[]) => {
      saved.push(next);
    }),
    saveAccounts: vi.fn(async () => {}),
    saveCategories: vi.fn(async () => {}),
  } as unknown as Parameters<typeof RepositoryProvider>[0]["value"];

  const USD_ACCT: Account = { ...EUR_ACCT, id: "acct-usd", name: "USD account", currency: "USD", sortOrder: 3 };
  const EUR_ACCT_2: Account = { ...EUR_ACCT, id: "acct-eur2", name: "EUR account 2", currency: "EUR", sortOrder: 4 };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(budgetKeys.accounts(), [EUR_ACCT, RUB_ACCT, USD_ACCT, EUR_ACCT_2]);
  client.setQueryData(budgetKeys.transactions(), [PLAIN_FLOW]);

  const currencies: Record<string, CurrencySettings> = {
    USD: formatDefaultsFor("USD"),
    EUR: formatDefaultsFor("EUR"),
    RUB: formatDefaultsFor("RUB"),
  };
  const config: CurrencyConfig = { currency: "USD", currencies, ...formatDefaultsFor("USD") };

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        RepositoryProvider,
        { value: repo },
        createElement(CurrencyContext.Provider, { value: config }, children),
      ),
    );

  return { saved, wrapper };
}

describe("useUpdateTransaction — plain flow rate resolution", () => {
  it("preserves the original stamp on an amount/merchant edit with the account unchanged", async () => {
    const { saved, wrapper } = setupPlain();
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...plainForm, amount: 15_000, merchant: "Café — updated" });
    });

    const flow = saved.at(-1)!.find((t) => t.id === "flow-1")!;
    expect(flow.fxRate).toBe(PLAIN_RATE); // historical stamp, never re-rated
    expect(flow.amount).toBe(-15_000);
    expect(flow.merchant).toBe("Café — updated");
  });

  it("preserves the stamp when moved between same-currency accounts", async () => {
    // A move is same-currency only (the form disables cross-currency targets),
    // so the flow's currency never changes — its historical stamp carries through
    // verbatim rather than re-rating to today's resolved rate.
    const { saved, wrapper } = setupPlain();
    const { result } = renderHook(() => useUpdateTransaction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...plainForm, accountId: "acct-eur2" });
    });

    const flow = saved.at(-1)!.find((t) => t.id === "flow-1")!;
    expect(flow.accountId).toBe("acct-eur2");
    expect(flow.fxRate).toBe(PLAIN_RATE); // historical stamp, not re-resolved
  });
});
