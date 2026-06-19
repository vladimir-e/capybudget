import { describe, expect, it } from "vitest";
import { CURRENCY_CODES } from "./currencies";

describe("currencies", () => {
  it("every code is 3-letter uppercase", () => {
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
  });

  it("includes the currencies Capy's users need", () => {
    const codes = new Set<string>(CURRENCY_CODES);
    for (const code of ["USD", "EUR", "UAH", "ARS", "KZT", "RUB"]) {
      expect(codes).toContain(code);
    }
  });

  it("excludes the stale RUR code", () => {
    expect(CURRENCY_CODES).not.toContain("RUR");
  });
});
