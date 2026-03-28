import { describe, it, expect } from "vitest";
import {
  transformCsv,
  parseCurrencyToCents,
  serializeImportCsv,
} from "./csv-transform";
import type { CsvMapping } from "./csv-mapping";

// ── Helpers ────────────────────────────────────────────────────────

/** Minimal mapping for tests that only care about one aspect. */
function baseMapping(overrides: Partial<CsvMapping> = {}): CsvMapping {
  return {
    date: { column: "Date", format: "YYYY-MM-DD" },
    description: { column: "Description" },
    amount: { style: "single", column: "Amount", sign: "negative_expense" },
    amountFormat: { format: "plain" },
    typeDetection: { method: "amount_sign" },
    sourceAccount: { literal: "Test Account" },
    sourceCategory: null,
    memo: null,
    ...overrides,
  };
}

function makeRow(fields: Record<string, string>): Record<string, string> {
  return fields;
}

// ── 1. Split amount columns (outflow/inflow style) ───────────────

describe("split amount columns", () => {
  const mapping = baseMapping({
    amount: { style: "split", expenseColumn: "Outflow", incomeColumn: "Inflow" },
    amountFormat: { format: "currency" },
  });

  it("row with only outflow produces expense with negative amount", () => {
    const rows = [
      makeRow({ Date: "2025-01-15", Description: "Groceries", Outflow: "$50.00", Inflow: "$0.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].type).toBe("expense");
    expect(result.transactions[0].amount).toBe(-5000);
  });

  it("row with only inflow produces income with positive amount", () => {
    const rows = [
      makeRow({ Date: "2025-01-15", Description: "Salary", Outflow: "$0.00", Inflow: "$3,000.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].type).toBe("income");
    expect(result.transactions[0].amount).toBe(300000);
  });

  it("row with both outflow and inflow nets them", () => {
    const rows = [
      makeRow({ Date: "2025-01-15", Description: "Adjustment", Outflow: "$100.00", Inflow: "$30.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    // Net = 30 - 100 = -70 → expense
    expect(result.transactions[0].type).toBe("expense");
    expect(result.transactions[0].amount).toBe(-7000);
  });

  it("row with both zero amounts treats as zero expense", () => {
    const rows = [
      makeRow({ Date: "2025-01-15", Description: "Balance adj", Outflow: "$0.00", Inflow: "$0.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].type).toBe("expense");
    expect(result.transactions[0].amount).toBe(0);
  });

  it("nets inflow > outflow as income", () => {
    const rows = [
      makeRow({ Date: "2025-01-15", Description: "Refund partial", Outflow: "$20.00", Inflow: "$80.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("income");
    expect(result.transactions[0].amount).toBe(6000);
  });
});

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

  it("memo resolves when provided", () => {
    const mapping = baseMapping({
      memo: { column: "Memo" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00", Memo: "My note" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].memo).toBe("My note");
  });

  it("memo is empty string when null in mapping", () => {
    const mapping = baseMapping({ memo: null });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].memo).toBe("");
  });
});

// ── 8. Full budget-export-style transform ─────────────────────────

describe("full budget-export-style transform", () => {
  const exportMapping: CsvMapping = {
    date: { column: "Date", format: "MM/DD/YYYY" },
    description: { columns: ["Payee", "Memo"], separator: " - " },
    amount: { style: "split", expenseColumn: "Outflow", incomeColumn: "Inflow" },
    amountFormat: { format: "currency" },
    typeDetection: { method: "rules", transferPatterns: ["Transfer :"] },
    sourceAccount: { column: "Account" },
    sourceCategory: { columns: ["Category Group", "Category"], separator: "/" },
    memo: { column: "Memo" },
    skipRules: [{ column: "Cleared", equals: "uncleared" }],
  };

  const exportRows = [
    {
      Account: "Checking",
      Flag: "",
      Date: "01/15/2025",
      Payee: "Whole Foods",
      "Category Group/Category": "Food/Groceries",
      "Category Group": "Food",
      Category: "Groceries",
      Memo: "weekly shop",
      Outflow: "$125.50",
      Inflow: "$0.00",
      Cleared: "Cleared",
    },
    {
      Account: "Checking",
      Flag: "",
      Date: "01/16/2025",
      Payee: "Employer Inc",
      "Category Group/Category": "Income/Salary",
      "Category Group": "Income",
      Category: "Salary",
      Memo: "January pay",
      Outflow: "$0.00",
      Inflow: "$5,000.00",
      Cleared: "Cleared",
    },
    {
      Account: "Checking",
      Flag: "",
      Date: "01/17/2025",
      Payee: "Transfer : Savings",
      "Category Group/Category": "",
      "Category Group": "",
      Category: "",
      Memo: "emergency fund",
      Outflow: "$500.00",
      Inflow: "$0.00",
      Cleared: "Cleared",
    },
    {
      Account: "Checking",
      Flag: "",
      Date: "01/18/2025",
      Payee: "Pending purchase",
      "Category Group/Category": "Shopping/Misc",
      "Category Group": "Shopping",
      Category: "Misc",
      Memo: "",
      Outflow: "$25.00",
      Inflow: "$0.00",
      Cleared: "Uncleared",
    },
  ];

  it("transforms the full export dataset correctly", () => {
    const result = transformCsv(exportRows, exportMapping);

    // Row 4 is skipped (Cleared = Uncleared)
    expect(result.stats.totalRows).toBe(4);
    expect(result.stats.transformed).toBe(3);
    expect(result.stats.skipped).toBe(1);
    expect(result.stats.errored).toBe(0);

    // Row 1: Expense
    const t0 = result.transactions[0];
    expect(t0.id).toBe("imp-1");
    expect(t0.date).toBe("2025-01-15");
    expect(t0.description).toBe("Whole Foods - weekly shop");
    expect(t0.amount).toBe(-12550);
    expect(t0.type).toBe("expense");
    expect(t0.sourceAccount).toBe("Checking");
    expect(t0.sourceCategory).toBe("Food/Groceries");
    expect(t0.memo).toBe("weekly shop");
    expect(t0.merchant).toBe("");
    expect(t0.accountId).toBe("");
    expect(t0.categoryId).toBe("");
    expect(t0.categoryConfidence).toBe("");

    // Row 2: Income
    const t1 = result.transactions[1];
    expect(t1.id).toBe("imp-2");
    expect(t1.date).toBe("2025-01-16");
    expect(t1.description).toBe("Employer Inc - January pay");
    expect(t1.amount).toBe(500000);
    expect(t1.type).toBe("income");
    expect(t1.sourceAccount).toBe("Checking");
    expect(t1.sourceCategory).toBe("Income/Salary");

    // Row 3: Transfer (pattern match on "Transfer :")
    const t2 = result.transactions[2];
    expect(t2.id).toBe("imp-3");
    expect(t2.date).toBe("2025-01-17");
    expect(t2.description).toBe("Transfer : Savings - emergency fund");
    expect(t2.amount).toBe(-50000); // transfer outflow: preserves direction
    expect(t2.type).toBe("transfer");
    expect(t2.sourceAccount).toBe("Checking");
  });
});

// ── 9. Error handling ──────────────────────────────────────────────

describe("error handling", () => {
  it("missing column produces TransformError", () => {
    const mapping = baseMapping({
      description: { column: "Payee" },
    });
    // Row has "Description" but mapping expects "Payee"
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(1);
    expect(result.errors[0].message).toContain('column "Payee" not found');
  });

  it("invalid amount produces TransformError", () => {
    const mapping = baseMapping();
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "not-a-number" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("cannot parse amount");
  });

  it("error includes raw row data for debugging", () => {
    const mapping = baseMapping();
    const row = makeRow({ Date: "bad-date", Description: "Test", Amount: "10.00" });
    const result = transformCsv([row], mapping);
    expect(result.errors[0].rawValues).toEqual(row);
  });

  it("valid rows still produced alongside errors", () => {
    const mapping = baseMapping();
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Good", Amount: "-10.00" }),
      makeRow({ Date: "bad-date", Description: "Bad", Amount: "5.00" }),
      makeRow({ Date: "2025-01-03", Description: "Also good", Amount: "-20.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.transactions[0].description).toBe("Good");
    expect(result.transactions[1].description).toBe("Also good");
  });

  it("error row numbers are 1-indexed", () => {
    const mapping = baseMapping();
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "OK", Amount: "-10.00" }),
      makeRow({ Date: "2025-01-02", Description: "OK", Amount: "-20.00" }),
      makeRow({ Date: "garbage", Description: "Bad", Amount: "5.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.errors[0].row).toBe(3);
  });

  it("missing amount column on some rows", () => {
    const mapping = baseMapping({
      amount: { style: "split", expenseColumn: "Debit", incomeColumn: "Credit" },
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Test", Debit: "10.00", Credit: "0.00" }),
      makeRow({ Date: "2025-01-02", Description: "No debit col" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('column "Debit" not found');
  });
});

// ── 10. serializeImportCsv round-trip ──────────────────────────────

describe("serializeImportCsv", () => {
  it("produces valid CSV with correct headers", () => {
    const mapping = baseMapping();
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-42.00" })];
    const result = transformCsv(rows, mapping);
    const csv = serializeImportCsv(result.transactions);

    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,categoryId,categoryConfidence",
    );
  });

  it("round-trip: transform then serialize preserves data", () => {
    const mapping = baseMapping({
      sourceCategory: { column: "Category" },
      memo: { column: "Memo" },
    });
    const rows = [
      makeRow({ Date: "2025-06-15", Description: "Coffee Shop", Amount: "-4.50", Category: "Food", Memo: "morning latte" }),
      makeRow({ Date: "2025-06-16", Description: "Paycheck", Amount: "3000.00", Category: "Income", Memo: "" }),
    ];
    const result = transformCsv(rows, mapping);
    const csv = serializeImportCsv(result.transactions);
    const lines = csv.split("\n");

    expect(lines).toHaveLength(3); // header + 2 data rows

    // Parse the CSV manually to check values
    const row1 = lines[1].split(",");
    expect(row1[0]).toBe("imp-1"); // id
    expect(row1[1]).toBe("2025-06-15"); // date
    expect(row1[2]).toBe("Coffee Shop"); // description
    expect(row1[3]).toBe("-450"); // amount in cents
    expect(row1[4]).toBe("expense"); // type
    expect(row1[5]).toBe("Test Account"); // sourceAccount
    expect(row1[6]).toBe("Food"); // sourceCategory
    expect(row1[7]).toBe("morning latte"); // memo

    const row2 = lines[2].split(",");
    expect(row2[0]).toBe("imp-2");
    expect(row2[3]).toBe("300000");
    expect(row2[4]).toBe("income");
  });

  it("escapes values containing commas", () => {
    const mapping = baseMapping({
      memo: { column: "Memo" },
    });
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-10.00", Memo: "one, two, three" })];
    const result = transformCsv(rows, mapping);
    const csv = serializeImportCsv(result.transactions);

    expect(csv).toContain('"one, two, three"');
  });

  it("escapes values containing double quotes", () => {
    const mapping = baseMapping();
    const rows = [makeRow({ Date: "2025-01-01", Description: 'The "Best" Shop', Amount: "-10.00" })];
    const result = transformCsv(rows, mapping);
    const csv = serializeImportCsv(result.transactions);

    expect(csv).toContain('"The ""Best"" Shop"');
  });

  it("empty transactions produce header-only CSV", () => {
    const csv = serializeImportCsv([]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("id,date,description");
  });
});

// ── 11. Stats correctness ──────────────────────────────────────────

describe("stats correctness", () => {
  it("all counts sum correctly: transformed + skipped + errored = totalRows", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "Description", contains: "skip" }],
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "Good row", Amount: "-10.00" }),
      makeRow({ Date: "2025-01-02", Description: "Skip this", Amount: "-5.00" }),
      makeRow({ Date: "bad", Description: "Error row", Amount: "-5.00" }),
      makeRow({ Date: "2025-01-04", Description: "Another good", Amount: "-20.00" }),
      makeRow({ Date: "2025-01-05", Description: "Skip me too", Amount: "-3.00" }),
    ];
    const result = transformCsv(rows, mapping);

    expect(result.stats.totalRows).toBe(5);
    expect(result.stats.transformed).toBe(2);
    expect(result.stats.skipped).toBe(2);
    expect(result.stats.errored).toBe(1);
    expect(result.stats.transformed + result.stats.skipped + result.stats.errored).toBe(
      result.stats.totalRows,
    );
  });

  it("empty input produces all-zero stats", () => {
    const mapping = baseMapping();
    const result = transformCsv([], mapping);
    expect(result.stats).toEqual({ totalRows: 0, transformed: 0, skipped: 0, errored: 0 });
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("all rows valid: transformed equals totalRows", () => {
    const mapping = baseMapping();
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "A", Amount: "-1.00" }),
      makeRow({ Date: "2025-01-02", Description: "B", Amount: "-2.00" }),
      makeRow({ Date: "2025-01-03", Description: "C", Amount: "-3.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.stats.totalRows).toBe(3);
    expect(result.stats.transformed).toBe(3);
    expect(result.stats.skipped).toBe(0);
    expect(result.stats.errored).toBe(0);
  });

  it("all rows skipped", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "Description", contains: "x" }],
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "x1", Amount: "-1.00" }),
      makeRow({ Date: "2025-01-02", Description: "x2", Amount: "-2.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.stats.totalRows).toBe(2);
    expect(result.stats.transformed).toBe(0);
    expect(result.stats.skipped).toBe(2);
    expect(result.stats.errored).toBe(0);
  });

  it("all rows errored", () => {
    const mapping = baseMapping();
    const rows = [
      makeRow({ Date: "bad1", Description: "A", Amount: "-1.00" }),
      makeRow({ Date: "bad2", Description: "B", Amount: "-2.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.stats.totalRows).toBe(2);
    expect(result.stats.transformed).toBe(0);
    expect(result.stats.skipped).toBe(0);
    expect(result.stats.errored).toBe(2);
  });
});

// ── Sequential IDs ─────────────────────────────────────────────────

describe("sequential IDs", () => {
  it("assigns sequential imp-N ids starting at 1", () => {
    const mapping = baseMapping();
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "A", Amount: "-1.00" }),
      makeRow({ Date: "2025-01-02", Description: "B", Amount: "-2.00" }),
      makeRow({ Date: "2025-01-03", Description: "C", Amount: "-3.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions.map((t) => t.id)).toEqual(["imp-1", "imp-2", "imp-3"]);
  });

  it("skipped rows do not consume IDs", () => {
    const mapping = baseMapping({
      skipRules: [{ column: "Description", equals: "skip" }],
    });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "A", Amount: "-1.00" }),
      makeRow({ Date: "2025-01-02", Description: "skip", Amount: "-2.00" }),
      makeRow({ Date: "2025-01-03", Description: "B", Amount: "-3.00" }),
    ];
    const result = transformCsv(rows, mapping);
    expect(result.transactions.map((t) => t.id)).toEqual(["imp-1", "imp-2"]);
  });
});

// ── Default fields ─────────────────────────────────────────────────

describe("default fields on ImportTransaction", () => {
  it("sets merchant, accountId, categoryId, categoryConfidence to empty strings", () => {
    const mapping = baseMapping();
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-5.00" })];
    const result = transformCsv(rows, mapping);
    const t = result.transactions[0];
    expect(t.merchant).toBe("");
    expect(t.accountId).toBe("");
    expect(t.categoryId).toBe("");
    expect(t.categoryConfidence).toBe("");
  });
});
