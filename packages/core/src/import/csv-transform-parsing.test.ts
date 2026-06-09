import { describe, it, expect } from "vitest";
import {
  transformCsv,
  parseCurrencyToCents,
  DEFAULT_TRANSFER_PATTERNS,
} from "./csv-transform";
import { baseMapping, makeRow } from "./csv-transform.test-helpers";

// ── 2. Single signed amount column ─────────────────────────────────

describe("single signed amount column", () => {
  it("negative_expense: negative value is expense", () => {
    const mapping = baseMapping({
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    });
    const rows = [makeRow({ Date: "2025-03-01", Description: "Coffee", Amount: "-4.50" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
    expect(result.transactions[0].amount).toBe(-450);
  });

  it("negative_expense: positive value is income", () => {
    const mapping = baseMapping({
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    });
    const rows = [makeRow({ Date: "2025-03-01", Description: "Refund", Amount: "25.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("income");
    expect(result.transactions[0].amount).toBe(2500);
  });

  it("positive_expense: positive value is expense", () => {
    const mapping = baseMapping({
      amount: { style: "single", column: "Amount", sign: "positive_expense" },
    });
    const rows = [makeRow({ Date: "2025-03-01", Description: "Purchase", Amount: "99.99" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
    expect(result.transactions[0].amount).toBe(-9999);
  });

  it("positive_expense: negative value is income", () => {
    const mapping = baseMapping({
      amount: { style: "single", column: "Amount", sign: "positive_expense" },
    });
    const rows = [makeRow({ Date: "2025-03-01", Description: "Credit", Amount: "-150.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("income");
    expect(result.transactions[0].amount).toBe(15000);
  });
});

// ── 3. Currency parsing (parseCurrencyToCents) ─────────────────────

describe("parseCurrencyToCents", () => {
  it("parses plain number", () => {
    expect(parseCurrencyToCents("1234.56", "plain", 1)).toBe(123456);
  });

  it("parses currency-formatted string with symbols and commas", () => {
    expect(parseCurrencyToCents("$1,234.56", "currency", 1)).toBe(123456);
  });

  it("parses negative with currency symbol", () => {
    expect(parseCurrencyToCents("-$50.00", "currency", 1)).toBe(-5000);
  });

  it("parses parenthesized negative", () => {
    expect(parseCurrencyToCents("($50.00)", "currency", 1)).toBe(-5000);
  });

  it("parses parenthesized negative without currency symbol", () => {
    expect(parseCurrencyToCents("(50.00)", "plain", 1)).toBe(-5000);
  });

  it("parses European format", () => {
    expect(parseCurrencyToCents("1.234,56", "european", 1)).toBe(123456);
  });

  it("parses European format without thousands separator", () => {
    expect(parseCurrencyToCents("234,56", "european", 1)).toBe(23456);
  });

  it("returns 0 for empty string", () => {
    expect(parseCurrencyToCents("", "plain", 1)).toBe(0);
  });

  it("returns 0 for whitespace-only", () => {
    expect(parseCurrencyToCents("   ", "plain", 1)).toBe(0);
  });

  it("returns 0 for $0.00", () => {
    expect(parseCurrencyToCents("$0.00", "currency", 1)).toBe(0);
  });

  it("returns 0 for bare 0.00", () => {
    expect(parseCurrencyToCents("0.00", "plain", 1)).toBe(0);
  });

  it("returns 0 for bare dash", () => {
    expect(parseCurrencyToCents("-", "plain", 1)).toBe(0);
  });

  it("handles euro symbol", () => {
    expect(parseCurrencyToCents("€1,234.56", "currency", 1)).toBe(123456);
  });

  it("handles pound symbol", () => {
    expect(parseCurrencyToCents("£99.99", "currency", 1)).toBe(9999);
  });

  it("rounds to nearest cent", () => {
    expect(parseCurrencyToCents("10.005", "plain", 1)).toBe(1001);
    expect(parseCurrencyToCents("10.004", "plain", 1)).toBe(1000);
  });

  it("throws on non-numeric garbage", () => {
    expect(() => parseCurrencyToCents("abc", "plain", 1)).toThrow('cannot parse amount "abc"');
  });
});

// ── 4. Date format parsing ─────────────────────────────────────────

describe("date format parsing", () => {
  it("MM/DD/YYYY to YYYY-MM-DD", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } });
    const rows = [makeRow({ Date: "03/15/2025", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-03-15");
  });

  it("MM/DD/YYYY pads single-digit month and day", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } });
    const rows = [makeRow({ Date: "1/5/2025", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-01-05");
  });

  it("DD.MM.YYYY to YYYY-MM-DD", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "DD.MM.YYYY" } });
    const rows = [makeRow({ Date: "25.12.2025", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-12-25");
  });

  it("YYYY-MM-DD passes through unchanged", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "YYYY-MM-DD" } });
    const rows = [makeRow({ Date: "2025-06-01", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-06-01");
  });

  it("DD/MM/YYYY to YYYY-MM-DD", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "DD/MM/YYYY" } });
    const rows = [makeRow({ Date: "31/12/2025", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-12-31");
  });

  it("MM-DD-YYYY to YYYY-MM-DD", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "MM-DD-YYYY" } });
    const rows = [makeRow({ Date: "07-04-2025", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-07-04");
  });

  it("YYYY/MM/DD to YYYY-MM-DD", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "YYYY/MM/DD" } });
    const rows = [makeRow({ Date: "2025/01/20", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-01-20");
  });

  it("invalid date value produces an error", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "YYYY-MM-DD" } });
    const rows = [makeRow({ Date: "not-a-date", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("cannot parse date");
  });

  it("unsupported format string produces an error", () => {
    const mapping = baseMapping({ date: { column: "Date", format: "DD-MMM-YYYY" } });
    const rows = [makeRow({ Date: "15-Mar-2025", Description: "Test", Amount: "10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("unsupported date format");
  });

  it("a literal date applies to every row, with no date column read", () => {
    const mapping = baseMapping({ date: { literal: "2026-06-07" } });
    const rows = [
      makeRow({ Description: "A", Amount: "10.00" }),
      makeRow({ Description: "B", Amount: "20.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.errors).toHaveLength(0);
    expect(result.transactions.map((t) => t.date)).toEqual(["2026-06-07", "2026-06-07"]);
  });
});

// ── 5. Type detection ──────────────────────────────────────────────

describe("type detection", () => {
  it("amount_sign method: expense when amount is negative", () => {
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Groceries", Amount: "-50.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
  });

  it("amount_sign method: income when amount is positive", () => {
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Paycheck", Amount: "3000.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("income");
  });

  it("transfer pattern matching is case-insensitive", () => {
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign", transferPatterns: ["transfer"] },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "TRANSFER to Savings", Amount: "-500.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("transfer pattern matches substring", () => {
    const mapping = baseMapping({
      typeDetection: { method: "rules", transferPatterns: ["Transfer :"] },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Transfer : Checking to Savings", Amount: "-200.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("transfer pattern does not match unrelated description", () => {
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign", transferPatterns: ["transfer"] },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Grocery Store", Amount: "-50.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
  });

  it("transfer takes priority over amount sign", () => {
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign", transferPatterns: ["xfer"] },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "XFER from checking", Amount: "500.00" })];
    const result = transformCsv(rows, mapping);
    // Would normally be income based on positive amount, but transfer pattern wins
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("multiple transfer patterns — any match triggers transfer", () => {
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign", transferPatterns: ["transfer", "xfer", "between accounts"] },
    });
    const r1 = transformCsv(
      [makeRow({ Date: "2025-01-01", Description: "move between accounts", Amount: "-100.00" })],
      mapping,
    );
    expect(r1.transactions[0].type).toBe("transfer");
  });
});

// ── 5b. Built-in default transfer patterns ─────────────────────────

describe("default transfer patterns", () => {
  it("classifies an ACH internet transfer when the model supplies no patterns", () => {
    const mapping = baseMapping({ typeDetection: { method: "amount_sign" } });
    const rows = [
      makeRow({
        Date: "2025-01-01",
        Description: "Ach Deposit Internet Transfer From Account En",
        Amount: "666.10",
      }),
    ];
    const result = transformCsv(rows, mapping);
    // Positive amount would otherwise be income — the default pattern wins.
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("does not false-match a merchant that merely contains 'transfer'", () => {
    const mapping = baseMapping({ typeDetection: { method: "amount_sign" } });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Transferwise Inc", Amount: "-50.00" }),
      makeRow({ Date: "2025-01-02", Description: "Money Transfer Inc", Amount: "-25.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
    expect(result.transactions[1].type).toBe("expense");
  });

  it("covers a wire transfer phrasing the model did not supply", () => {
    const mapping = baseMapping({ typeDetection: { method: "amount_sign" } });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Outgoing Wire Transfer Cc Payment", Amount: "-1200.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("model-supplied patterns still classify additively", () => {
    // "xfer" is not a default; only the model-supplied pattern can catch it.
    const mapping = baseMapping({
      typeDetection: { method: "amount_sign", transferPatterns: ["xfer"] },
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "XFER from checking", Amount: "500.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("every default phrase pairs 'transfer' with account context", () => {
    // Guards against a bare/over-broad phrase sneaking into the set.
    for (const pattern of DEFAULT_TRANSFER_PATTERNS) {
      expect(pattern).toContain("transfer");
      expect(pattern.split(/\s+/).length).toBeGreaterThan(1);
    }
  });
});

// ── 6. Skip rules ──────────────────────────────────────────────────

describe("skip rules", () => {
  it("contains match skips the row", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "Description", contains: "opening balance" }],
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Opening Balance", Amount: "1000.00" }),
      makeRow({ Date: "2025-01-02", Description: "Coffee shop", Amount: "-5.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe("Coffee shop");
    expect(result.stats.skipped).toBe(1);
  });

  it("equals match skips the row (case-insensitive)", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "Type", equals: "void" }],
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Voided txn", Amount: "0.00", Type: "VOID" }),
      makeRow({ Date: "2025-01-02", Description: "Purchase", Amount: "-20.00", Type: "sale" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe("Purchase");
    expect(result.stats.skipped).toBe(1);
  });

  it("non-matching row passes through", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "Description", contains: "skip me" }],
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Keep me", Amount: "-10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.stats.skipped).toBe(0);
  });

  it("multiple skip rules — any match triggers skip", () => {
    const mapping = baseMapping({
      skipRules: [
        { column: "Description", contains: "balance" },
        { column: "Description", equals: "pending" },
      ],
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Opening balance", Amount: "0.00" }),
      makeRow({ Date: "2025-01-02", Description: "Pending", Amount: "-10.00" }),
      makeRow({ Date: "2025-01-03", Description: "Coffee", Amount: "-5.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.stats.skipped).toBe(2);
  });

  it("missing column in skip rule does not crash (treats as empty)", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "NonExistent", contains: "something" }],
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Normal", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
  });

  it("no skip rules means nothing is skipped", () => {
    const mapping = baseMapping({ skipRules: undefined });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.stats.skipped).toBe(0);
  });
});

// ── 7. Column references ───────────────────────────────────────────

describe("column references", () => {
  it("single column reference resolves description", () => {
    const mapping = baseMapping({
      description: { column: "Payee" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Payee: "Starbucks", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].description).toBe("Starbucks");
  });

  it("multi-column concatenation with separator", () => {
    const mapping = baseMapping({
      description: { columns: ["Payee", "Memo"], separator: " - " },
    });
    const rows = [makeRow({ Date: "2025-01-01", Payee: "Amazon", Memo: "Books order", Amount: "-29.99" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].description).toBe("Amazon - Books order");
  });

  it("multi-column skips empty values in concatenation", () => {
    const mapping = baseMapping({
      description: { columns: ["Payee", "Memo"], separator: " | " },
    });
    const rows = [makeRow({ Date: "2025-01-01", Payee: "Target", Memo: "", Amount: "-15.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].description).toBe("Target");
  });

  it("multi-column with three columns", () => {
    const mapping = baseMapping({
      description: { columns: ["Payee", "Category", "Note"], separator: " / " },
    });
    const rows = [makeRow({ Date: "2025-01-01", Payee: "Walmart", Category: "Groceries", Note: "weekly", Amount: "-100.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].description).toBe("Walmart / Groceries / weekly");
  });

  it("source account from column", () => {
    const mapping = baseMapping({
      sourceAccount: { column: "Account" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00", Account: "Checking" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].sourceAccount).toBe("Checking");
  });

  it("source account from literal", () => {
    const mapping = baseMapping({
      sourceAccount: { literal: "My Savings" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].sourceAccount).toBe("My Savings");
  });

  it("sourceCategory resolves when provided", () => {
    const mapping = baseMapping({
      sourceCategory: { column: "Category" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00", Category: "Food" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].sourceCategory).toBe("Food");
  });

  it("sourceCategory is empty string when null in mapping", () => {
    const mapping = baseMapping({ sourceCategory: null });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].sourceCategory).toBe("");
  });
});

// ── Column-based type detection ───────────────────────────────────

describe("column-based type detection", () => {
  const mapping = baseMapping({
    typeDetection: {
      method: "column",
      typeColumn: "Type",
      typeMap: { debit: "expense", credit: "income", xfer: "transfer" },
    },
  });

  it("reads type from column using typeMap", () => {
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Coffee", Amount: "-5.00", Type: "debit" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
  });

  it("maps credit to income", () => {
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Salary", Amount: "3000.00", Type: "credit" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("income");
  });

  it("maps custom transfer value", () => {
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Move funds", Amount: "-500.00", Type: "xfer" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("falls through to amount-sign for unknown type values", () => {
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Unknown", Amount: "-10.00", Type: "misc" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
  });

  it("transfer patterns override column type", () => {
    const mapping2 = baseMapping({
      typeDetection: {
        method: "column",
        typeColumn: "Type",
        typeMap: { debit: "expense" },
        transferPatterns: ["transfer to"],
      },
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Transfer to savings", Amount: "-500.00", Type: "debit" }),
    ];
    const result = transformCsv(rows, mapping2);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("is case-insensitive on column values", () => {
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00", Type: "DEBIT" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("expense");
  });
});

// ── Date validation ───────────────────────────────────────────────

describe("date validation rejects impossible dates", () => {
  it("rejects February 31", () => {
    const rows = [makeRow({ Date: "02/31/2025", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("invalid date");
  });

  it("rejects month 13", () => {
    const rows = [makeRow({ Date: "13/01/2025", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("invalid date");
  });

  it("rejects month 0", () => {
    const rows = [makeRow({ Date: "00/15/2025", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("invalid date");
  });

  it("rejects day 0", () => {
    const rows = [makeRow({ Date: "2025-01-00", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("invalid date");
  });

  it("accepts valid leap year date", () => {
    const rows = [makeRow({ Date: "02/29/2024", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } }));
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date).toBe("2024-02-29");
  });

  it("rejects invalid leap year date", () => {
    const rows = [makeRow({ Date: "02/29/2025", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } }));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("invalid date");
  });
});

// ── Date-with-time stripping ──────────────────────────────────────

describe("date-with-time stripping", () => {
  it("strips ISO timestamp from YYYY-MM-DD", () => {
    const rows = [makeRow({ Date: "2025-01-15T14:30:00", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping());
    expect(result.transactions[0].date).toBe("2025-01-15");
  });

  it("strips space-separated time from MM/DD/YYYY", () => {
    const rows = [makeRow({ Date: "01/15/2025 10:00", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "MM/DD/YYYY" } }));
    expect(result.transactions[0].date).toBe("2025-01-15");
  });

  it("strips timestamp from DD.MM.YYYY", () => {
    const rows = [makeRow({ Date: "15.03.2025 08:30:00", Description: "X", Amount: "-1.00" })];
    const result = transformCsv(rows, baseMapping({ date: { column: "Date", format: "DD.MM.YYYY" } }));
    expect(result.transactions[0].date).toBe("2025-03-15");
  });
});

// ── Multi-character currency codes ────────────────────────────────

describe("multi-character currency codes", () => {
  it("strips CHF prefix", () => {
    expect(parseCurrencyToCents("CHF 1,234.56", "currency", 1)).toBe(123456);
  });

  it("strips USD prefix", () => {
    expect(parseCurrencyToCents("USD 50.00", "currency", 1)).toBe(5000);
  });

  it("strips trailing currency code", () => {
    expect(parseCurrencyToCents("1234.56 USD", "currency", 1)).toBe(123456);
  });

  it("strips EUR with european format", () => {
    expect(parseCurrencyToCents("EUR 1.234,56", "european", 1)).toBe(123456);
  });

  it("strips GBP prefix", () => {
    expect(parseCurrencyToCents("GBP 99.99", "currency", 1)).toBe(9999);
  });
});
