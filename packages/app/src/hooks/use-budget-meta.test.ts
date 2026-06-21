import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useBudgetMeta } from "./use-budget-meta";

const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

// The unified currency shape: a single USD budget with the default entry only.
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBudgetMeta", () => {
  it("setCurrency re-seeds the default entry from the new currency's defaults, preserving identity fields", async () => {
    mockReadTextFile.mockResolvedValue(JSON.stringify(STORED_META));

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    // Wait for the stored meta to load — currency "USD" also matches the
    // default, so key on `name` to know the real file resolved.
    await waitFor(() => expect(result.current.data.name).toBe("My Budget"));

    await act(async () => {
      await result.current.setCurrency("RUB");
    });

    expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
    const [path, contents] = mockWriteTextFile.mock.calls[0] as [string, string];
    expect(path).toBe("/b/budget.json");

    const written = JSON.parse(contents);
    expect(written.defaultCurrency).toBe("RUB");
    // The new default's entry re-seeds from RUB's defaults — no minor unit,
    // trailing symbol.
    expect(written.currencies.RUB).toEqual({ decimals: 0, symbolPosition: "after" });
    expect(written.name).toBe("My Budget");
    expect(written.schemaVersion).toBe(4);
    expect(written.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(written.lastModified).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("setBudgetFormat persists the default entry's decimals + symbol position without touching the currency", async () => {
    mockReadTextFile.mockResolvedValue(JSON.stringify(STORED_META));

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    await waitFor(() => expect(result.current.data.name).toBe("My Budget"));

    await act(async () => {
      await result.current.setBudgetFormat({ decimals: 0, symbolPosition: "off" });
    });

    const written = JSON.parse((mockWriteTextFile.mock.calls[0] as [string, string])[1]);
    expect(written.defaultCurrency).toBe("USD");
    expect(written.currencies.USD).toEqual({ decimals: 0, symbolPosition: "off" });
  });

  it("setName renames the budget while preserving the rest", async () => {
    mockReadTextFile.mockResolvedValue(JSON.stringify(STORED_META));

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    await waitFor(() => expect(result.current.data.name).toBe("My Budget"));

    await act(async () => {
      await result.current.setName("Renamed");
    });

    const written = JSON.parse((mockWriteTextFile.mock.calls[0] as [string, string])[1]);
    expect(written.name).toBe("Renamed");
    expect(written.defaultCurrency).toBe("USD");
    expect(written.currencies.USD.decimals).toBe(2);
  });

  it("composes back-to-back field edits from the latest value, not a stale snapshot", async () => {
    mockReadTextFile.mockResolvedValue(JSON.stringify(STORED_META));

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    await waitFor(() => expect(result.current.data.name).toBe("My Budget"));

    // Fire two different field setters back-to-back without an intervening
    // re-render. The second composes from the just-cached value, so the first's
    // change survives instead of being clobbered by a stale `data` snapshot.
    await act(async () => {
      await Promise.all([
        result.current.setCurrency("EUR"),
        result.current.setBudgetFormat({ decimals: 1, symbolPosition: "off" }),
      ]);
    });

    // Last write wins on disk, and the chain serializes so the file carries
    // both edits — the new default from the first, its format from the second.
    const lastCall = mockWriteTextFile.mock.calls.at(-1) as [string, string];
    const persisted = JSON.parse(lastCall[1]);
    expect(persisted.defaultCurrency).toBe("EUR");
    expect(persisted.currencies.EUR).toEqual({ decimals: 1, symbolPosition: "off" });

    await waitFor(() => {
      expect(result.current.data.defaultCurrency).toBe("EUR");
      expect(result.current.data.currencies.EUR).toEqual({
        decimals: 1,
        symbolPosition: "off",
      });
    });
  });

  it("normalizes an old flat-shape budget.json into the unified map", async () => {
    // A budget.json from before the unified map: flat currency fields, no
    // `currencies`. The hook lifts them into the default entry and backfills
    // anything missing from the currency's defaults.
    mockReadTextFile.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 4,
        name: "Legacy",
        currency: "RUB",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastModified: "2026-01-01T00:00:00.000Z",
      }),
    );

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    await waitFor(() => expect(result.current.data.name).toBe("Legacy"));
    expect(result.current.data.defaultCurrency).toBe("RUB");
    // RUB has no minor unit and a trailing symbol — backfilled from defaults.
    expect(result.current.data.currencies.RUB).toEqual({
      decimals: 0,
      symbolPosition: "after",
    });
    // The superseded flat fields are dropped from the normalized shape.
    expect(result.current.data).not.toHaveProperty("currency");
    expect(result.current.data).not.toHaveProperty("currencyDecimals");
  });
});
