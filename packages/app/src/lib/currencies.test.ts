/**
 * Currency-list policy: curated currencies lead, the enumerated rest is
 * deduped against them, and an absent `Intl.supportedValuesOf` degrades to
 * the curated list alone. The module reads `Intl.supportedValuesOf` at import
 * time, so each scenario re-imports under a reset module registry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("currencies", () => {
  it("lists curated currencies first and dedups the rest against them", async () => {
    const { ALL_CURRENCIES, CURATED_CURRENCIES, REST_CURRENCIES } = await import("./currencies");

    expect(ALL_CURRENCIES.slice(0, CURATED_CURRENCIES.length)).toEqual(CURATED_CURRENCIES);

    const curatedCodes = new Set(CURATED_CURRENCIES.map((c) => c.code));
    expect(REST_CURRENCIES.every((c) => !curatedCodes.has(c.code))).toBe(true);

    // No code appears twice across the assembled list.
    const codes = ALL_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("the rest is sorted alphabetically by code", async () => {
    const { REST_CURRENCIES } = await import("./currencies");
    const codes = REST_CURRENCIES.map((c) => c.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it("falls back to just the curated list when Intl.supportedValuesOf is unavailable", async () => {
    vi.stubGlobal("Intl", { ...Intl, supportedValuesOf: undefined });
    vi.resetModules();

    const { ALL_CURRENCIES, CURATED_CURRENCIES, REST_CURRENCIES } = await import("./currencies");
    expect(REST_CURRENCIES).toHaveLength(0);
    expect(ALL_CURRENCIES).toEqual(CURATED_CURRENCIES);
  });
});
