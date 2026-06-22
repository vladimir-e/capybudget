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

// Vlad's real scenario, with clean rates so every cent is exact: default RUB,
// foreign USD (1 USD = 90 ₽) and IDR (1 ₽ = 200 IDR, so 1 IDR = 0.005 ₽). Money
// is ×100 for every currency, including the zero-decimal ones — so "1,000,000
// IDR" is 100_000_000 cents and converts the same way any other balance does.
describe("createConverter — RUB default, USD + IDR foreign", () => {
  const USD_RATE = 90; // ₽ per 1 USD-unit (native→default)
  const IDR_RATE = 0.005; // ₽ per 1 IDR-unit
  const converter = createConverter(
    new Map([
      ["USD", USD_RATE],
      ["IDR", IDR_RATE],
    ]),
    "RUB",
  );

  describe("flowToDefault", () => {
    it("values a USD flow at its stamped rate", () => {
      // $100.00 = 10_000 cents stamped at 90 → 900_000 ₽-cents (9,000 ₽).
      expect(converter.flowToDefault(10_000, USD_RATE)).toBe(900_000);
    });

    it("values an IDR flow at its stamped rate (zero-decimal still ×100)", () => {
      // 1,000,000 IDR = 100_000_000 cents stamped at 0.005 → 500_000 ₽-cents.
      expect(converter.flowToDefault(100_000_000, IDR_RATE)).toBe(500_000);
    });

    it("is the identity when the stamped rate is exactly 1 (no float round-trip)", () => {
      expect(converter.flowToDefault(123_456_789, 1)).toBe(123_456_789);
    });

    it("treats an absent stamp as 1.0 (a default-currency RUB flow)", () => {
      expect(converter.flowToDefault(7_777)).toBe(7_777);
    });

    it("rounds half away from zero per Math.round at the boundary", () => {
      // 5 IDR-cents × 0.005 = 0.025 → Math.round → 0; 99 × 0.005 = 0.495 → 0.
      expect(converter.flowToDefault(5, IDR_RATE)).toBe(0);
      expect(converter.flowToDefault(99, IDR_RATE)).toBe(0);
      // 101 × 0.005 = 0.505 → 1; 100 × 0.005 = 0.5 → Math.round(0.5) = 1.
      expect(converter.flowToDefault(100, IDR_RATE)).toBe(1);
      expect(converter.flowToDefault(101, IDR_RATE)).toBe(1);
    });

    it("preserves sign (an outflow stays negative)", () => {
      expect(converter.flowToDefault(-10_000, USD_RATE)).toBe(-900_000);
    });
  });

  describe("holdingToDefault", () => {
    it("values a USD balance at today's USD rate", () => {
      expect(converter.holdingToDefault(10_000, "USD")).toBe(900_000);
    });

    it("values an IDR balance at today's IDR rate", () => {
      expect(converter.holdingToDefault(100_000_000, "IDR")).toBe(500_000);
    });

    it("is the identity for the default currency (RUB)", () => {
      expect(converter.holdingToDefault(42_000, "RUB")).toBe(42_000);
    });

    it("is the identity for an absent currency (a default-currency account)", () => {
      expect(converter.holdingToDefault(42_000)).toBe(42_000);
    });

    it("falls back to 1.0 for a currency with no rate in the map", () => {
      expect(converter.holdingToDefault(42_000, "JPY")).toBe(42_000);
    });
  });
});
