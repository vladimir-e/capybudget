/**
 * Integration test: transform engine vs real YNAB export format.
 * Uses inline YNAB-formatted data to verify end-to-end correctness.
 */

import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { transformCsv, serializeImportCsv } from "./csv-transform";
import type { CsvMapping } from "./csv-mapping";

// Realistic YNAB CSV data (matches the actual export format)
const YNAB_CSV = `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
"Tinkoff","","12/31/2019","Transfer : Alfa","","","","",$415.38,$0.00,"Reconciled"
"🏦 BofA Checking","","12/31/2019","Transfer : 💵 Cash","","","","",$300.00,$0.00,"Reconciled"
"💵 Cash","","12/31/2019","","Immediate Obligations: Groceries 🥑","Immediate Obligations","Groceries 🥑","",$110.00,$0.00,"Reconciled"
"Alfa Potok","","12/31/2019","Alfa Potok","","","","Loss",$106.06,$0.00,"Reconciled"
"Capital One Savor","","12/31/2019","Bay Gourmet Corp Brooklyn NY USA","Immediate Obligations: Groceries 🥑","Immediate Obligations","Groceries 🥑","",$26.65,$0.00,"Reconciled"
"🏦 BofA Checking","","12/31/2019","Transfer : BofA Secured Credit Card","","","","",$20.00,$0.00,"Reconciled"
"Capital One Savor","","12/31/2019","Vucciria Food","Immediate Obligations: Groceries 🥑","Immediate Obligations","Groceries 🥑","",$14.22,$0.00,"Reconciled"
"Amex Blue Cash","","12/31/2019","Vucciria Food","Immediate Obligations: Groceries 🥑","Immediate Obligations","Groceries 🥑","",$12.25,$0.00,"Reconciled"
"💃 Discover it","","12/31/2019","","Leisure: Fun / Hobby / Toys 🎲","Leisure","Fun / Hobby / Toys 🎲","new yorker",$6.00,$0.00,"Reconciled"
"Tinkoff","","12/31/2019","FNS","As Needed: Interest & Fees","As Needed","Interest & Fees","fees",$0.20,$0.00,"Reconciled"
"BofA Secured Credit Card","","12/31/2019","Transfer : 🏦 BofA Checking","","","","",$0.00,$20.00,"Reconciled"
"Tinkoff Platinum","","12/31/2019","Transfer : Tinkoff","","","","",$0.00,$35.15,"Reconciled"
"💵 Cash","","12/31/2019","Transfer : 🏦 BofA Checking","","","","",$0.00,$300.00,"Reconciled"
"Alfa","","12/31/2019","Transfer : Tinkoff","","","","",$0.00,$415.38,"Reconciled"
"🏦 BofA Checking","","06/20/2019","Employer Inc","Inflow: Ready to Assign","Inflow","Ready to Assign","paycheck",$0.00,"$3,456.78","Reconciled"`;

const YNAB_MAPPING: CsvMapping = {
  date: { column: "Date", format: "MM/DD/YYYY" },
  description: { column: "Payee" },
  amount: { style: "split", expenseColumn: "Outflow", incomeColumn: "Inflow" },
  amountFormat: { format: "currency" },
  typeDetection: { method: "rules", transferPatterns: ["Transfer :"] },
  sourceAccount: { column: "Account" },
  sourceCategory: { column: "Category Group/Category" },
  memo: { column: "Memo" },
  skipRules: [],
};

describe("YNAB format integration", () => {
  const parsed = Papa.parse<Record<string, string>>(YNAB_CSV, {
    header: true,
    skipEmptyLines: true,
  });
  const result = transformCsv(parsed.data, YNAB_MAPPING);

  it("transforms all rows without errors", () => {
    expect(result.errors).toHaveLength(0);
    expect(result.stats.totalRows).toBe(15);
    expect(result.stats.transformed).toBe(15);
    expect(result.stats.errored).toBe(0);
  });

  it("parses dates to YYYY-MM-DD", () => {
    // All Dec 31 rows
    expect(result.transactions[0].date).toBe("2019-12-31");
    // The June row
    expect(result.transactions[14].date).toBe("2019-06-20");
  });

  it("converts outflow amounts to negative cents", () => {
    // $415.38 outflow
    expect(result.transactions[0].amount).toBe(-41538);
    // $300.00 outflow
    expect(result.transactions[1].amount).toBe(-30000);
    // $0.20 outflow
    expect(result.transactions[9].amount).toBe(-20);
  });

  it("converts inflow amounts to positive cents", () => {
    // $20.00 inflow
    expect(result.transactions[10].amount).toBe(2000);
    // $3,456.78 inflow
    expect(result.transactions[14].amount).toBe(345678);
  });

  it("detects transfers by pattern", () => {
    expect(result.transactions[0].type).toBe("transfer"); // "Transfer : Alfa"
    expect(result.transactions[1].type).toBe("transfer"); // "Transfer : 💵 Cash"
    expect(result.transactions[5].type).toBe("transfer"); // "Transfer : BofA Secured"
  });

  it("detects expenses and income", () => {
    expect(result.transactions[2].type).toBe("expense"); // Groceries outflow
    expect(result.transactions[14].type).toBe("income"); // Paycheck inflow
  });

  it("preserves source accounts with emoji", () => {
    expect(result.transactions[1].sourceAccount).toBe("🏦 BofA Checking");
    expect(result.transactions[2].sourceAccount).toBe("💵 Cash");
    expect(result.transactions[8].sourceAccount).toBe("💃 Discover it");
  });

  it("preserves source categories", () => {
    expect(result.transactions[2].sourceCategory).toBe("Immediate Obligations: Groceries 🥑");
    expect(result.transactions[8].sourceCategory).toBe("Leisure: Fun / Hobby / Toys 🎲");
  });

  it("preserves memos", () => {
    expect(result.transactions[3].memo).toBe("Loss");
    expect(result.transactions[8].memo).toBe("new yorker");
    expect(result.transactions[14].memo).toBe("paycheck");
  });

  it("leaves enrichment fields empty", () => {
    for (const t of result.transactions) {
      expect(t.merchant).toBe("");
      expect(t.accountId).toBe("");
      expect(t.categoryId).toBe("");
      expect(t.categoryConfidence).toBe("");
    }
  });

  it("generates sequential IDs", () => {
    expect(result.transactions[0].id).toBe("imp-1");
    expect(result.transactions[14].id).toBe("imp-15");
  });

  it("serializes to valid CSV", () => {
    const csv = serializeImportCsv(result.transactions);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,categoryId,categoryConfidence",
    );
    // 15 data rows + 1 header
    expect(lines).toHaveLength(16);

    // Re-parse and verify round-trip
    const reparsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    });
    expect(reparsed.data).toHaveLength(15);
    expect(parseInt(reparsed.data[0].amount, 10)).toBe(-41538);
  });

  it("handles empty payee (description) gracefully", () => {
    // Row 3 (index 2) has empty Payee
    expect(result.transactions[2].description).toBe("");
  });
});
