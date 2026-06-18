import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatMoneyCompact,
  currencySymbol,
  getAmountClass,
  parseMoney,
} from "./money";

describe("formatMoney", () => {
  it("formats positive cents in USD", () => {
    expect(formatMoney(1250, "USD")).toBe("$12.50");
  });

  it("formats zero", () => {
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("formats negative cents", () => {
    expect(formatMoney(-1250, "USD")).toBe("-$12.50");
  });

  it("pads single-digit cents", () => {
    expect(formatMoney(5, "USD")).toBe("$0.05");
  });

  it("formats large amounts with locale separators", () => {
    expect(formatMoney(123456789, "USD")).toBe("$1,234,567.89");
  });

  it("formats EUR with its symbol", () => {
    expect(formatMoney(1250, "EUR")).toBe("€12.50");
  });

  it("formats GBP with its symbol", () => {
    expect(formatMoney(1250, "GBP")).toBe("£12.50");
  });

  it("formats JPY with no minor unit (1000 cents → ¥10)", () => {
    expect(formatMoney(1000, "JPY")).toBe("¥10");
  });

  it("formats negative JPY", () => {
    expect(formatMoney(-1000, "JPY")).toBe("-¥10");
  });
});

describe("formatMoneyCompact", () => {
  it("drops cents for amounts >= 100_000 (USD)", () => {
    expect(formatMoneyCompact(123456, "USD")).toBe("$1,235");
  });

  it("keeps cents just below the threshold", () => {
    expect(formatMoneyCompact(99999, "USD")).toBe("$999.99");
  });

  it("drops cents exactly at the threshold", () => {
    expect(formatMoneyCompact(100000, "USD")).toBe("$1,000");
  });

  it("drops cents for negative amounts >= threshold", () => {
    expect(formatMoneyCompact(-250000, "USD")).toBe("-$2,500");
  });

  it("keeps cents for negative amounts below threshold", () => {
    expect(formatMoneyCompact(-5000, "USD")).toBe("-$50.00");
  });

  it("formats zero", () => {
    expect(formatMoneyCompact(0, "USD")).toBe("$0.00");
  });

  it("is currency-aware above the threshold (EUR)", () => {
    expect(formatMoneyCompact(123456, "EUR")).toBe("€1,235");
  });

  it("is currency-aware below the threshold (JPY)", () => {
    expect(formatMoneyCompact(1000, "JPY")).toBe("¥10");
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for common currencies", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("JPY")).toBe("¥");
  });
});

describe("getAmountClass", () => {
  it("returns transfer class for transfer type", () => {
    expect(getAmountClass({ type: "transfer", amount: -5000 })).toBe("text-amount-transfer");
  });

  it("returns transfer class for positive transfer", () => {
    expect(getAmountClass({ type: "transfer", amount: 5000 })).toBe("text-amount-transfer");
  });

  it("returns expense class for negative amount", () => {
    expect(getAmountClass({ type: "expense", amount: -3500 })).toBe("text-amount-expense");
  });

  it("returns income class for positive amount", () => {
    expect(getAmountClass({ type: "income", amount: 10000 })).toBe("text-amount-income");
  });

  it("returns income class for zero amount", () => {
    expect(getAmountClass({ type: "income", amount: 0 })).toBe("text-amount-income");
  });
});

describe("parseMoney", () => {
  it("parses dollar string to cents", () => {
    expect(parseMoney("$12.50")).toBe(1250);
  });

  it("parses without dollar sign", () => {
    expect(parseMoney("12.50")).toBe(1250);
  });

  it("parses whole dollars", () => {
    expect(parseMoney("12")).toBe(1200);
  });

  it("parses single decimal place", () => {
    expect(parseMoney("12.5")).toBe(1250);
  });

  it("returns 0 for garbage input", () => {
    expect(parseMoney("abc")).toBe(0);
  });

  it("parses negative values", () => {
    expect(parseMoney("-$12.50")).toBe(-1250);
  });
});
