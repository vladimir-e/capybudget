import { describe, expect, it } from "vitest";
import { formatMoney, formatMoneyCompact, getAmountClass, parseMoney } from "./money";

describe("formatMoney", () => {
  it("formats positive cents", () => {
    expect(formatMoney(1250)).toBe("$12.50");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats negative cents", () => {
    expect(formatMoney(-1250)).toBe("-$12.50");
  });

  it("pads single-digit cents", () => {
    expect(formatMoney(5)).toBe("$0.05");
  });

  it("formats large amounts with locale separators", () => {
    const result = formatMoney(123456789);
    expect(result).toMatch(/\$1,234,567\.89/);
  });
});

describe("formatMoneyCompact", () => {
  it("drops cents for amounts >= $1000", () => {
    expect(formatMoneyCompact(123456)).toBe("$1,234");
  });

  it("keeps cents for amounts < $1000", () => {
    expect(formatMoneyCompact(99999)).toBe("$999.99");
  });

  it("drops cents for exactly $1000", () => {
    expect(formatMoneyCompact(100000)).toBe("$1,000");
  });

  it("drops cents for negative amounts >= $1000", () => {
    expect(formatMoneyCompact(-250000)).toBe("-$2,500");
  });

  it("keeps cents for negative amounts < $1000", () => {
    expect(formatMoneyCompact(-5000)).toBe("-$50.00");
  });

  it("formats zero", () => {
    expect(formatMoneyCompact(0)).toBe("$0.00");
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
