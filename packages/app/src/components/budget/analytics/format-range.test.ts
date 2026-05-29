import { describe, it, expect } from "vitest";
import { formatMoney } from "@capybudget/core";
import type { DateRange, Transaction } from "@capybudget/core";
import { formatDrilldownSubtitle } from "./format-range";

// The helper only reads `.amount` and `.length`, so minimal stubs suffice.
const txn = (amount: number) => ({ amount }) as Transaction;

const MAY_2026: DateRange = {
  start: new Date(2026, 4, 1),
  end: new Date(2026, 5, 1),
};

describe("formatDrilldownSubtitle", () => {
  it("omits the total for a single transaction", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(4567)]);
    expect(result).toBe("May 2026 · 1 transaction");
  });

  it("appends the abs-summed total for two or more transactions", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(1000), txn(2500)]);
    expect(result).toBe(`May 2026 · 2 transactions · ${formatMoney(3500)}`);
  });

  it("uses each transaction's absolute amount so the total reconciles with the clicked figure", () => {
    const result = formatDrilldownSubtitle(MAY_2026, "month", [txn(1000), txn(-2500)]);
    expect(result).toBe(`May 2026 · 2 transactions · ${formatMoney(3500)}`);
  });
});
