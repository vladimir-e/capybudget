import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { formatDefaultsFor, SEED_RATES, type CurrencySettings } from "@capybudget/core";
import { CurrencyContext, type CurrencyConfig, useConverter } from "./currency-context";

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
