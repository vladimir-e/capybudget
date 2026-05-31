import { describe, it, expect } from "vitest";
import { transformCsv } from "./csv-transform";
import type { CsvMapping } from "./csv-mapping";
import { baseMapping, makeRow } from "./csv-transform.test-helpers";

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

// ── Bank-style CSV integration ────────────────────────────────────

describe("bank-style CSV (single signed amount, MM/DD/YYYY, currency)", () => {
  const mapping = baseMapping({
    date: { column: "Date", format: "MM/DD/YYYY" },
    description: { column: "Description" },
    amount: { style: "single", column: "Amount", sign: "negative_expense" },
    amountFormat: { format: "currency" },
    typeDetection: { method: "rules", transferPatterns: ["transfer", "xfer"] },
    sourceAccount: { literal: "Chase Checking" },
    sourceCategory: null,
    memo: null,
  });

  it("parses expense with negative currency amount", () => {
    const rows = [makeRow({ Date: "03/15/2025", Description: "CHECKCARD 0315 STARBUCKS", Amount: "-$4.50" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0]).toMatchObject({
      date: "2025-03-15",
      amount: -450,
      type: "expense",
      sourceAccount: "Chase Checking",
    });
  });

  it("parses income with positive currency amount", () => {
    const rows = [makeRow({ Date: "03/30/2025", Description: "DIRECT DEPOSIT EMPLOYER INC", Amount: "$3,500.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0]).toMatchObject({
      date: "2025-03-30",
      amount: 350000,
      type: "income",
    });
  });

  it("detects transfer by description pattern", () => {
    const rows = [makeRow({ Date: "03/20/2025", Description: "ONLINE TRANSFER TO SAVINGS", Amount: "-$500.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].type).toBe("transfer");
  });

  it("parses parenthesized negative", () => {
    const rows = [makeRow({ Date: "03/20/2025", Description: "ATM FEE", Amount: "($25.00)" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].amount).toBe(-2500);
    expect(result.transactions[0].type).toBe("expense");
  });

  it("handles single-digit month and day", () => {
    const rows = [makeRow({ Date: "1/5/2025", Description: "Test", Amount: "-$10.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].date).toBe("2025-01-05");
  });
});

// ── European CSV integration ──────────────────────────────────────

describe("European CSV (DD.MM.YYYY, european amounts)", () => {
  const mapping = baseMapping({
    date: { column: "Datum", format: "DD.MM.YYYY" },
    description: { column: "Beschreibung" },
    amount: { style: "single", column: "Betrag", sign: "negative_expense" },
    amountFormat: { format: "european" },
    typeDetection: { method: "amount_sign" },
    sourceAccount: { literal: "Deutsche Bank" },
    sourceCategory: null,
    memo: null,
  });

  it("parses European expense", () => {
    const rows = [makeRow({ Datum: "15.03.2025", Beschreibung: "REWE Markt", Betrag: "-42,50" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0]).toMatchObject({
      date: "2025-03-15",
      amount: -4250,
      type: "expense",
      sourceAccount: "Deutsche Bank",
    });
  });

  it("parses European income with thousands separator", () => {
    const rows = [makeRow({ Datum: "30.03.2025", Beschreibung: "Gehalt", Betrag: "3.500,00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0]).toMatchObject({
      date: "2025-03-30",
      amount: 350000,
      type: "income",
    });
  });
});
