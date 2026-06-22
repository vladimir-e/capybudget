import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { formatDefaultsFor, formatMoney, SEED_RATES, type CurrencySettings } from "@capybudget/core";
import {
  CurrencyContext,
  type CurrencyConfig,
  useAccountMoney,
  useAccountSymbol,
  useConverter,
  useCurrencies,
  useFormatMoney,
} from "./currency-context";

function wrapper(currencies?: Record<string, CurrencySettings>) {
  const config: CurrencyConfig = {
    currency: "USD",
    currencies,
    ...formatDefaultsFor("USD"),
  };
  return ({ children }: { children: ReactNode }) => (
    <CurrencyContext.Provider value={config}>{children}</CurrencyContext.Provider>
  );
}

describe("useConverter — the cardinal invariant", () => {
  it("is the identity for a single-currency (USD-only) budget", () => {
    const { result } = renderHook(() => useConverter(), {
      wrapper: wrapper({ USD: formatDefaultsFor("USD") }),
    });
    // No foreign accounts: flows and holdings pass through untouched.
    expect(result.current.flowToDefault(12345, undefined)).toBe(12345);
    expect(result.current.holdingToDefault(12345, "USD")).toBe(12345);
  });

  it("is the identity when the settings map is absent (defaults to the default currency)", () => {
    const { result } = renderHook(() => useConverter(), { wrapper: wrapper(undefined) });
    expect(result.current.flowToDefault(999, undefined)).toBe(999);
    expect(result.current.holdingToDefault(999, "USD")).toBe(999);
  });

  it("lights up for a foreign account: flows read the stamp, holdings read today", () => {
    const { result } = renderHook(() => useConverter(), {
      wrapper: wrapper({
        USD: formatDefaultsFor("USD"),
        RUB: formatDefaultsFor("RUB"),
      }),
    });
    // Flow keeps its stamped rate (the day it happened).
    expect(result.current.flowToDefault(100_000, 0.016)).toBe(1_600);
    // Holding values at today's resolved rate (1/91 from the seed table).
    const today = 1 / SEED_RATES.rates.RUB;
    expect(result.current.holdingToDefault(100_000, "RUB")).toBe(Math.round(100_000 * today));
  });
});

describe("useCurrencies — absent-map fallback is referentially stable", () => {
  // Guards the memoized fallback: an inline `{ [currency]: ... }` each render
  // would return a fresh object and bust the useConverter memo. A revert to the
  // inline fallback fails this, not just perf.
  it("returns the same reference across renders when currencies is undefined", () => {
    const { result, rerender } = renderHook(() => useCurrencies(), {
      wrapper: wrapper(undefined),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("useAccountMoney — per-row amounts in the account's own currency", () => {
  const wrap = wrapper({ USD: formatDefaultsFor("USD"), RUB: formatDefaultsFor("RUB") });

  it("renders a default-currency amount byte-identical to the default formatter", () => {
    const { result } = renderHook(
      () => ({ account: useAccountMoney(), def: useFormatMoney() }),
      { wrapper: wrap },
    );
    // account.currency === default → exactly the configured default formatter.
    expect(result.current.account(123_45, "USD")).toBe(result.current.def.format(123_45));
    // undefined currency routes the same way (no account resolved).
    expect(result.current.account(123_45, undefined)).toBe(result.current.def.format(123_45));
  });

  it("renders a foreign amount in that currency's own symbol and display defaults", () => {
    const { result } = renderHook(() => useAccountMoney(), { wrapper: wrap });
    // 100,000 cents of ₽ shows under the ruble's defaults (no minor unit,
    // trailing symbol) — not the USD "$1,000.00".
    expect(result.current(100_000, "RUB")).toBe(
      formatMoney(100_000, "RUB", formatDefaultsFor("RUB"), "en-US"),
    );
    expect(result.current(100_000, "RUB")).not.toContain("$");
  });
});

describe("useAccountSymbol — inline editor affix", () => {
  const wrap = wrapper({ USD: formatDefaultsFor("USD"), RUB: formatDefaultsFor("RUB") });

  it("uses the default symbol/position for the default currency", () => {
    const { result } = renderHook(() => useAccountSymbol("USD"), { wrapper: wrap });
    expect(result.current).toEqual({ symbol: "$", symbolPosition: "before" });
  });

  it("uses the foreign currency's symbol and its default position", () => {
    const { result } = renderHook(() => useAccountSymbol("RUB"), { wrapper: wrap });
    expect(result.current).toEqual({ symbol: "₽", symbolPosition: "after" });
  });
});
