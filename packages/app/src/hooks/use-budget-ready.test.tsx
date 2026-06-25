import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { BudgetRepository } from "@capybudget/persistence";
import { RepositoryProvider } from "@/contexts/repository-context";
import { useBudgetReady } from "./use-budget-data";

const mockReadTextFile = vi.mocked(readTextFile);

const STORED_META = JSON.stringify({
  schemaVersion: 4,
  name: "My Budget",
  defaultCurrency: "USD",
  currencies: { USD: { decimals: 2, symbolPosition: "before" } },
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModified: "2026-01-01T00:00:00.000Z",
});

/** A deferred promise whose resolve is exposed, so a test can hold a query
 *  pending and release it on demand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadTextFile.mockResolvedValue(STORED_META);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBudgetReady", () => {
  it("is false while any data query is pending, true once all resolve", async () => {
    const accounts = deferred<[]>();
    const categories = deferred<[]>();
    const transactions = deferred<[]>();
    const repo = {
      getAccounts: () => accounts.promise,
      getCategories: () => categories.promise,
      getTransactions: () => transactions.promise,
    } as unknown as BudgetRepository;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return createElement(
        QueryClientProvider,
        { client },
        createElement(RepositoryProvider, { value: repo }, children),
      );
    }

    const { result } = renderHook(() => useBudgetReady("/b"), { wrapper });

    // Meta resolves quickly, but the three CSV queries are held pending.
    await waitFor(() => expect(mockReadTextFile).toHaveBeenCalled());
    expect(result.current).toBe(false);

    // Resolve two of three — still not ready.
    accounts.resolve([]);
    categories.resolve([]);
    await waitFor(() => expect(result.current).toBe(false));

    transactions.resolve([]);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("releases the gate when a query errors, fast — query-level retry is off", async () => {
    const repo = {
      getAccounts: () => Promise.resolve([]),
      getCategories: () => Promise.resolve([]),
      // A corrupt/locked CSV rejects. The query sets retry: false, so even a
      // retry-enabled client settles it to error immediately (no ~3s backoff).
      getTransactions: () => Promise.reject(new Error("corrupt CSV")),
    } as unknown as BudgetRepository;

    // Deliberately NOT overriding retry here — proves the hooks' own
    // `retry: false` is what prevents the readiness hang, not the test client.
    const client = new QueryClient();
    function wrapper({ children }: { children: ReactNode }) {
      return createElement(
        QueryClientProvider,
        { client },
        createElement(RepositoryProvider, { value: repo }, children),
      );
    }

    const { result } = renderHook(() => useBudgetReady("/b"), { wrapper });
    // pending → error flips isPending false, so the gate releases.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is true when every query resolves immediately (empty budget still readies)", async () => {
    const repo = {
      getAccounts: () => Promise.resolve([]),
      getCategories: () => Promise.resolve([]),
      getTransactions: () => Promise.resolve([]),
    } as unknown as BudgetRepository;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return createElement(
        QueryClientProvider,
        { client },
        createElement(RepositoryProvider, { value: repo }, children),
      );
    }

    const { result } = renderHook(() => useBudgetReady("/b"), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });
});
