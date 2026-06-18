/**
 * Currency-list policy: a single hand-curated list. No runtime enumeration,
 * so no stale ISO-4217 codes (RUR and friends) leak in. These assertions guard
 * the shape and the deliberate inclusions/exclusions.
 */

import { describe, expect, it } from "vitest";
import { CURRENCIES } from "./currencies";

describe("currencies", () => {
  it("every entry has a 3-letter uppercase code and a non-empty name", () => {
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(c.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate codes", () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes the currencies Capy's users need", () => {
    const codes = new Set(CURRENCIES.map((c) => c.code));
    for (const code of ["USD", "EUR", "UAH", "ARS", "KZT", "RUB"]) {
      expect(codes).toContain(code);
    }
  });

  it("excludes the stale RUR code", () => {
    expect(CURRENCIES.some((c) => c.code === "RUR")).toBe(false);
  });
});
