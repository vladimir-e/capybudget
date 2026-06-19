import { describe, it, expect } from "vitest";
import { formatMoney } from "@capybudget/core";
import type { DateRange, Transaction } from "@capybudget/core";
import { i18n } from "@capybudget/i18n";
import { formatRangeLabel, formatDrilldownSubtitle } from "./format-range";

// The helper only reads `.amount` and `.length`, so minimal stubs suffice.
const txn = (amount: number) => ({ amount }) as Transaction;

// Stand-in for the currency-bound formatter the app threads from useFormatMoney.
const format = (cents: number) =>
  formatMoney(cents, "USD", { decimals: 2, symbolPosition: "before" });

// Real `analytics`-scoped translators per language, so the test exercises the
// shipped catalog strings (incl. Russian plural rules) end to end.
const tEn = i18n.getFixedT("en", "analytics");
const tRu = i18n.getFixedT("ru", "analytics");

const MAY_2026: DateRange = {
  start: new Date(2026, 4, 1),
  end: new Date(2026, 5, 1),
};

const JAN_MAR_2026: DateRange = {
  start: new Date(2026, 0, 1),
  end: new Date(2026, 3, 1),
};

describe("formatRangeLabel", () => {
  it("renders the month-and-year in the active language", () => {
    expect(formatRangeLabel(MAY_2026, "month", "en", tEn)).toBe("May 2026");
    expect(formatRangeLabel(MAY_2026, "month", "ru", tRu)).toBe("май 2026 г.");
  });

  it("localizes the short months in a custom cross-month range", () => {
    expect(formatRangeLabel(JAN_MAR_2026, "custom", "en", tEn)).toBe("Jan – Mar 2026");
    expect(formatRangeLabel(JAN_MAR_2026, "custom", "ru", tRu)).toBe("янв. – март 2026");
  });

  it("localizes the quarter label", () => {
    expect(formatRangeLabel(JAN_MAR_2026, "quarter", "en", tEn)).toBe("Q1 2026");
    expect(formatRangeLabel(JAN_MAR_2026, "quarter", "ru", tRu)).toBe("1 кв. 2026");
  });

  it("localizes the all-time label", () => {
    expect(formatRangeLabel(MAY_2026, "allTime", "en", tEn)).toBe("All Time");
    expect(formatRangeLabel(MAY_2026, "allTime", "ru", tRu)).toBe("За всё время");
  });
});

describe("formatDrilldownSubtitle", () => {
  it("omits the total for a single transaction", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(4567)], format, "en", tEn);
    expect(result).toBe("May 2026 · 1 transaction");
  });

  it("appends the abs-summed total for two or more transactions", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(1000), txn(2500)], format, "en", tEn);
    expect(result).toBe(`May 2026 · 2 transactions · ${format(3500)}`);
  });

  it("uses each transaction's absolute amount so the total reconciles with the clicked figure", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(1000), txn(-2500)], format, "en", tEn);
    expect(result).toBe(`May 2026 · 2 transactions · ${format(3500)}`);
  });

  it("localizes the range label and the transaction count", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(4567)], format, "ru", tRu);
    expect(result).toBe("май 2026 г. · 1 операция");
  });
});
