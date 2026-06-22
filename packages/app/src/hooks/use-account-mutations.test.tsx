import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  buildTodayRates,
  createConverter,
  formatDefaultsFor,
  type Account,
  type CurrencySettings,
} from "@capybudget/core";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useBudgetMeta } from "@/hooks/use-budget-meta";
import { useCreateAccount } from "./use-account-mutations";

const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);

const BUDGET_PATH = "/b";

// A single-currency USD budget — no RUB entry yet, so the converter has no rate
// for it until creation seeds one.
const STORED_META = {
  schemaVersion: 4,
  name: "My Budget",
  defaultCurrency: "USD",
  currencies: { USD: { decimals: 2, symbolPosition: "before" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModified: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteTextFile.mockResolvedValue(undefined);
  mockReadTextFile.mockResolvedValue(JSON.stringify(STORED_META));
});

function setup() {
  const repo = {
    saveAccounts: vi.fn(async () => {}),
    saveTransactions: vi.fn(async () => {}),
    saveCategories: vi.fn(async () => {}),
  } as unknown as Parameters<typeof RepositoryProvider>[0]["value"];

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(budgetKeys.accounts(), [] as Account[]);

  const currencies: Record<string, CurrencySettings> = { USD: formatDefaultsFor("USD") };
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

  return { client, repo, wrapper };
}

describe("useCreateAccount — foreign-currency seeding", () => {
  it("registers a new foreign account's currency so holdings value correctly without opening Settings", async () => {
    const { wrapper } = setup();
    // Drive both hooks from one wrapper: `useBudgetMeta` shares the budget.json
    // cache the create hook seeds into, mirroring how CurrencyProvider reads it.
    const { result } = renderHook(
      () => ({
        create: useCreateAccount(BUDGET_PATH),
        meta: useBudgetMeta(BUDGET_PATH),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.meta.data.name).toBe("My Budget"));
    expect(result.current.meta.data.currencies.RUB).toBeUndefined();

    await act(async () => {
      await result.current.create.mutateAsync({ name: "Russian acct", type: "checking", currency: "RUB" });
    });

    // budget.json gained an RUB entry from RUB's curated display defaults.
    const metaWrite = mockWriteTextFile.mock.calls
      .map((c) => c as [string, string])
      .find(([p]) => p === `${BUDGET_PATH}/budget.json`);
    expect(metaWrite).toBeDefined();
    const written = JSON.parse(metaWrite![1]);
    expect(written.currencies.RUB).toEqual({ decimals: 0, symbolPosition: "after" });

    // The map the converter would consume now resolves RUB at the seed rate —
    // 100 ₽ ≈ $1.10 at 1/91, not $100 at a 1:1 fallback.
    await waitFor(() => expect(result.current.meta.data.currencies.RUB).toBeDefined());
    const converter = createConverter(
      buildTodayRates(result.current.meta.data.currencies, "USD"),
      "USD",
    );
    expect(converter.holdingToDefault(10_000, "RUB")).toBe(Math.round(10_000 / 91));
  });

  it("does not seed an entry for an account in the budget default currency", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({
        create: useCreateAccount(BUDGET_PATH),
        meta: useBudgetMeta(BUDGET_PATH),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.meta.data.name).toBe("My Budget"));

    await act(async () => {
      await result.current.create.mutateAsync({ name: "Checking", type: "checking", currency: "USD" });
    });

    // No budget.json write — the default currency already has its entry.
    const metaWrite = mockWriteTextFile.mock.calls.find(
      (c) => (c as [string, string])[0] === `${BUDGET_PATH}/budget.json`,
    );
    expect(metaWrite).toBeUndefined();
  });
});
