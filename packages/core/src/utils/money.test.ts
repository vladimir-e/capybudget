import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatMoneyCompact,
  formatDefaultsFor,
  resolveBudgetFormat,
  CURRENCY_FORMAT_DEFAULTS,
  currencySymbol,
  getAmountClass,
  parseMoney,
  type MoneyFormat,
} from "./money";

const before2: MoneyFormat = { decimals: 2, symbolPosition: "before" };
const after2: MoneyFormat = { decimals: 2, symbolPosition: "after" };
const off2: MoneyFormat = { decimals: 2, symbolPosition: "off" };
const before0: MoneyFormat = { decimals: 0, symbolPosition: "before" };
const after0: MoneyFormat = { decimals: 0, symbolPosition: "after" };

describe("formatMoney — symbol position", () => {
  it("before: symbol hugs the number, no space", () => {
    expect(formatMoney(123456, "USD", before2)).toBe("$1,234.56");
    expect(formatMoney(123456, "KZT", before2)).toBe("₸1,234.56");
  });

  it("after: one separating space before the symbol", () => {
    expect(formatMoney(10000, "RUB", after2)).toBe("100.00 ₽");
    expect(formatMoney(123456, "UAH", after2)).toBe("1,234.56 ₴");
  });

  it("off: bare number, no symbol", () => {
    expect(formatMoney(123456, "USD", off2)).toBe("1,234.56");
  });
});

describe("formatMoney — sign handling", () => {
  it("places the minus outside a before-symbol", () => {
    expect(formatMoney(-123456, "USD", before2)).toBe("-$1,234.56");
  });

  it("places the minus outside an after-symbol", () => {
    expect(formatMoney(-10000, "RUB", after0)).toBe("-100 ₽");
  });

  it("places the minus on a bare off number", () => {
    expect(formatMoney(-123456, "USD", off2)).toBe("-1,234.56");
  });

  it("formats zero without a sign", () => {
    expect(formatMoney(0, "USD", before2)).toBe("$0.00");
    expect(formatMoney(0, "USD", off2)).toBe("0.00");
  });
});

describe("formatMoney — precision and rounding", () => {
  it("rounds to the chosen decimals (0-decimal RUB)", () => {
    // 123456 cents = 1234.56 → rounds to 1,235 at 0 decimals
    expect(formatMoney(123456, "RUB", after0)).toBe("1,235 ₽");
  });

  it("pads to the chosen decimals", () => {
    expect(formatMoney(5, "USD", before2)).toBe("$0.05");
  });

  it("keeps cents on a sub-unit amount at 0 decimals by rounding", () => {
    expect(formatMoney(49, "USD", before0)).toBe("$0");
    expect(formatMoney(50, "USD", before0)).toBe("$1");
  });
});

describe("formatMoney — symbol-less currencies", () => {
  it("before collapses to a bare number (CHF)", () => {
    expect(formatMoney(123456, "CHF", before2)).toBe("1,234.56");
  });

  it("after collapses to a bare number — no stray space (CHF)", () => {
    expect(formatMoney(123456, "CHF", after2)).toBe("1,234.56");
  });

  it("keeps the minus for a symbol-less negative", () => {
    expect(formatMoney(-123456, "CHF", after2)).toBe("-1,234.56");
  });

  it("off matches symbol-less before/after", () => {
    expect(formatMoney(123456, "AED", off2)).toBe("1,234.56");
    expect(formatMoney(123456, "AED", after2)).toBe("1,234.56");
  });
});

describe("formatMoney — composition matrix", () => {
  // before/after/off × symbol(USD) vs symbol-less(CHF) × +/− × decimals 0 and 2
  const cases: Array<[number, string, MoneyFormat, string]> = [
    [123456, "USD", before2, "$1,234.56"],
    [-123456, "USD", before2, "-$1,234.56"],
    [123456, "USD", after2, "1,234.56 $"],
    [-123456, "USD", after2, "-1,234.56 $"],
    [123456, "USD", off2, "1,234.56"],
    [-123456, "USD", off2, "-1,234.56"],
    [123456, "USD", before0, "$1,235"],
    [-123456, "USD", after0, "-1,235 $"],
    [123456, "CHF", before2, "1,234.56"],
    [-123456, "CHF", before2, "-1,234.56"],
    [123456, "CHF", after2, "1,234.56"],
    [123456, "CHF", off2, "1,234.56"],
    [123456, "CHF", before0, "1,235"],
  ];
  it.each(cases)("formatMoney(%i, %s, %o) → %s", (cents, currency, fmt, expected) => {
    expect(formatMoney(cents, currency, fmt)).toBe(expected);
  });
});

describe("formatMoneyCompact", () => {
  it("drops cents for amounts >= 100_000 (USD before)", () => {
    expect(formatMoneyCompact(123456, "USD", before2)).toBe("$1,235");
  });

  it("keeps cents just below the threshold", () => {
    expect(formatMoneyCompact(99999, "USD", before2)).toBe("$999.99");
  });

  it("drops cents exactly at the threshold", () => {
    expect(formatMoneyCompact(100000, "USD", before2)).toBe("$1,000");
  });

  it("drops cents for large negatives, keeping the sign and position", () => {
    expect(formatMoneyCompact(-250000, "RUB", after2)).toBe("-2,500 ₽");
  });

  it("keeps cents for negatives below the threshold", () => {
    expect(formatMoneyCompact(-5000, "USD", before2)).toBe("-$50.00");
  });

  it("is a no-op for a currency already at 0 decimals above the threshold", () => {
    expect(formatMoneyCompact(123456, "RUB", after0)).toBe("1,235 ₽");
  });

  it("composes off and symbol-less the same as formatMoney above the threshold", () => {
    expect(formatMoneyCompact(123456789, "CHF", before2)).toBe("1,234,568");
    expect(formatMoneyCompact(150000, "USD", off2)).toBe("1,500");
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for common currencies", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("JPY")).toBe("¥");
  });

  it("returns the narrow symbol for non-Latin currencies", () => {
    expect(currencySymbol("KZT")).toBe("₸");
    expect(currencySymbol("RUB")).toBe("₽");
  });

  it("returns an empty string when no symbol exists (never the ISO code)", () => {
    expect(currencySymbol("CHF")).toBe("");
    expect(currencySymbol("AED")).toBe("");
  });
});

describe("formatDefaultsFor", () => {
  it("RUB defaults to 0 decimals, symbol after", () => {
    expect(formatDefaultsFor("RUB")).toEqual({ decimals: 0, symbolPosition: "after" });
  });

  it("KZT and UAH keep 2 decimals but place the symbol after", () => {
    expect(formatDefaultsFor("KZT")).toEqual({ decimals: 2, symbolPosition: "after" });
    expect(formatDefaultsFor("UAH")).toEqual({ decimals: 2, symbolPosition: "after" });
  });

  it("IDR is 0-decimal but keeps the leading symbol", () => {
    expect(formatDefaultsFor("IDR")).toEqual({ decimals: 0, symbolPosition: "before" });
  });

  it("USD falls back to the Intl baseline (2 decimals, before)", () => {
    expect(formatDefaultsFor("USD")).toEqual({ decimals: 2, symbolPosition: "before" });
  });

  it("an unlisted 0-decimal currency resolves its Intl precision", () => {
    expect(formatDefaultsFor("JPY")).toEqual({ decimals: 0, symbolPosition: "before" });
  });

  it("returns a fresh object so callers can't mutate the curated table", () => {
    const a = formatDefaultsFor("RUB");
    a.decimals = 2;
    expect(CURRENCY_FORMAT_DEFAULTS.RUB.decimals).toBe(0);
  });
});

describe("resolveBudgetFormat", () => {
  it("backfills every missing field from the currency's curated defaults", () => {
    expect(resolveBudgetFormat({ currency: "RUB" })).toEqual({
      currency: "RUB",
      decimals: 0,
      symbolPosition: "after",
    });
  });

  it("defaults a missing currency to USD and its baseline format", () => {
    expect(resolveBudgetFormat({})).toEqual({
      currency: "USD",
      decimals: 2,
      symbolPosition: "before",
    });
  });

  it("preserves explicit overrides over the curated defaults", () => {
    expect(
      resolveBudgetFormat({ currency: "RUB", currencyDecimals: 2, currencySymbolPosition: "off" }),
    ).toEqual({ currency: "RUB", decimals: 2, symbolPosition: "off" });
  });

  it("clamps a stored decimals above the integer-cents ceiling down to 2", () => {
    expect(resolveBudgetFormat({ currency: "USD", currencyDecimals: 3 }).decimals).toBe(2);
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
