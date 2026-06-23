import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import {
  formatDefaultsFor,
  type BudgetMeta,
  type Transaction,
} from "@capybudget/core";
import { makeAccount, makeTransaction } from "@capybudget/core/test-factories";
import { createInMemoryRepository } from "@capybudget/persistence";
import { RepositoryProvider } from "@/contexts/repository-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useRebaseCurrency } from "./use-rebase-currency";

// useRebaseCurrency reads the budget meta through this hook; supply it directly
// so the test controls the default currency + rate map without a budget.json
// round-trip. `save` is the meta writer the rebase persists the new default to.
const saveMeta = vi.fn<(meta: BudgetMeta) => Promise<void>>(async () => {});
let meta: BudgetMeta;

vi.mock("@/hooks/use-budget-meta", () => ({
  useBudgetMeta: () => ({ data: meta, isLoading: false, save: saveMeta }),
}));

function rubBudget(): BudgetMeta {
  return {
    schemaVersion: 4,
    name: "Test Budget",
    defaultCurrency: "RUB",
    currencies: { RUB: { decimals: 0, symbolPosition: "after" } },
    createdAt: "",
    lastModified: "",
  };
}

function renderRebase(repo: ReturnType<typeof createInMemoryRepository>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RepositoryProvider, { value: repo }, children),
    );
  const { result } = renderHook(() => useRebaseCurrency("/b"), { wrapper });
  return { rebase: result.current, queryClient };
}

describe("useRebaseCurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    meta = rubBudget();
  });

  // The headline data-loss guard. The trigger surface (currency-section) warms
  // only the accounts query, so the transactions query is routinely cold when a
  // user opens Settings without visiting the budget table. A cache-reading
  // rebase would hand the transform `[]` and persist it back — wiping
  // transactions.csv. Reading authoritative repo state must keep every row.
  it("does NOT erase transactions when the transactions query is cold (multi-currency switch)", async () => {
    const rub = makeAccount({ id: "rub", currency: "RUB" });
    const idr = makeAccount({ id: "idr", currency: "IDR" });
    // A foreign IDR account makes this a multi-currency budget, so the transform
    // rebases (rewrites) transactions — the path that, on cold cache, wiped them.
    const idrTxn = makeTransaction({
      id: "t-idr",
      accountId: "idr",
      amount: -1_600_000_000,
      fxRate: 91 / 16000,
    });
    const rubTxn = makeTransaction({ id: "t-rub", accountId: "rub", amount: -150_000 });
    const repo = createInMemoryRepository({
      accounts: [rub, idr],
      transactions: [idrTxn, rubTxn],
    });

    const { rebase, queryClient } = renderRebase(repo);
    // Cold cache: neither query was ever read. This is the bug's precondition.
    expect(queryClient.getQueryData(budgetKeys.transactions())).toBeUndefined();

    await act(async () => {
      await rebase("USD");
    });

    // The transactions survive — same count, same native amounts (rebase never
    // moves money, only the unit of account).
    const after = await repo.getTransactions();
    expect(after).toHaveLength(2);
    expect(after.map((t) => t.id).sort()).toEqual(["t-idr", "t-rub"]);
    expect(after.find((t) => t.id === "t-idr")!.amount).toBe(-1_600_000_000);
    expect(after.find((t) => t.id === "t-rub")!.amount).toBe(-150_000);

    // The new default landed in meta.
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0][0].defaultCurrency).toBe("USD");

    // The cache now reflects the persisted state (seeded even though it was cold).
    const cached = queryClient.getQueryData<Transaction[]>(budgetKeys.transactions());
    expect(cached).toHaveLength(2);
  });

  // A single-currency relabel must not rewrite transactions.csv — the reference
  // optimization still has to hold against repo-loaded arrays, so the unchanged
  // transactions array is never re-saved.
  it("relabels a single-currency budget without rewriting transactions", async () => {
    meta = {
      ...rubBudget(),
      defaultCurrency: "USD",
      currencies: { USD: formatDefaultsFor("USD") },
    };
    const usd = makeAccount({ id: "usd", currency: "USD" });
    const txn = makeTransaction({ id: "t", accountId: "usd", amount: -5000 });
    const repo = createInMemoryRepository({ accounts: [usd], transactions: [txn] });
    const saveTransactions = vi.spyOn(repo, "saveTransactions");
    const saveAccounts = vi.spyOn(repo, "saveAccounts");

    const { rebase } = renderRebase(repo);
    await act(async () => {
      await rebase("EUR");
    });

    // No foreign account → relabel: accounts move to EUR, transactions untouched.
    expect(saveAccounts).toHaveBeenCalledTimes(1);
    expect(saveTransactions).not.toHaveBeenCalled();
    const accounts = await repo.getAccounts();
    expect(accounts[0].currency).toBe("EUR");
    const after = await repo.getTransactions();
    expect(after).toHaveLength(1);
    expect(after[0].amount).toBe(-5000);
  });
});
