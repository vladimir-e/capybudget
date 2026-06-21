import { describe, it, expect } from "vitest";
import { IDENTITY_CONVERTER, createConverter } from "./converter";

describe("IDENTITY_CONVERTER", () => {
  it("returns flows unchanged regardless of stamped rate", () => {
    expect(IDENTITY_CONVERTER.flowToDefault(12345)).toBe(12345);
    expect(IDENTITY_CONVERTER.flowToDefault(12345, 0.5)).toBe(12345);
    expect(IDENTITY_CONVERTER.flowToDefault(-9999, 2)).toBe(-9999);
  });

  it("returns holdings unchanged regardless of currency", () => {
    expect(IDENTITY_CONVERTER.holdingToDefault(50000)).toBe(50000);
    expect(IDENTITY_CONVERTER.holdingToDefault(50000, "RUB")).toBe(50000);
  });
});

describe("createConverter", () => {
  const rates = new Map([
    ["RUB", 0.011],
    ["EUR", 1.08],
  ]);
  const converter = createConverter(rates, "USD");

  describe("flowToDefault — stamped rate", () => {
    it("rounds native × stamped rate to integer cents", () => {
      // 100_000 ₽ stamped at 0.016 → $1,600
      expect(converter.flowToDefault(10_000_000, 0.016)).toBe(160_000);
    });

    it("ignores today's rate — only the stamp matters", () => {
      // Same balance, stamped at the old rate, is unaffected by RUB today.
      expect(converter.flowToDefault(10_000_000, 0.016)).toBe(160_000);
      expect(converter.flowToDefault(10_000_000, 0.011)).toBe(110_000);
    });

    it("treats an absent stamp as 1.0 (a default-currency transaction)", () => {
      expect(converter.flowToDefault(4242)).toBe(4242);
    });

    it("preserves sign and rounds half away from the native sign per Math.round", () => {
      expect(converter.flowToDefault(333, 0.011)).toBe(Math.round(333 * 0.011));
    });
  });

  describe("holdingToDefault — today's rate", () => {
    it("values a foreign balance at today's rate for its currency", () => {
      // 100_000 ₽ today at 0.011 → $1,100
      expect(converter.holdingToDefault(10_000_000, "RUB")).toBe(110_000);
    });

    it("is the identity for the default currency", () => {
      expect(converter.holdingToDefault(50_000, "USD")).toBe(50_000);
    });

    it("is the identity for an absent currency (account on the default)", () => {
      expect(converter.holdingToDefault(50_000)).toBe(50_000);
    });

    it("falls back to 1.0 for a currency with no rate", () => {
      expect(converter.holdingToDefault(50_000, "JPY")).toBe(50_000);
    });

    it("rounds a non-even product to integer cents", () => {
      // 333 × 0.011 = 3.663 → 4
      expect(converter.holdingToDefault(333, "RUB")).toBe(Math.round(333 * 0.011));
      expect(converter.holdingToDefault(333, "RUB")).toBe(4);
    });
  });

  it("flows and holdings on the same balance diverge by the FX delta", () => {
    // The ₽ income flowed in at 0.016 ($1,600); today it is worth $1,100 at
    // 0.011. The −$500 gap is unrealized FX loss — both numbers are correct.
    const flow = converter.flowToDefault(10_000_000, 0.016);
    const holding = converter.holdingToDefault(10_000_000, "RUB");
    expect(flow).toBe(160_000);
    expect(holding).toBe(110_000);
    expect(holding - flow).toBe(-50_000);
  });
});
