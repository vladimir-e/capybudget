import { describe, it, expect } from "vitest";
import { transformCsv, serializeImportCsv } from "./csv-transform";
import { baseMapping, makeRow } from "./csv-transform.test-helpers";

// ── 10. serializeImportCsv round-trip ──────────────────────────────

describe("serializeImportCsv", () => {
  it("produces valid CSV with correct headers", () => {
    const mapping = baseMapping();
    const rows = [makeRow({ Date: "2025-01-01", Description: "Test", Amount: "-42.00" })];
    const result = transformCsv(rows, mapping);
    const csv = serializeImportCsv(result.transactions);

    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence,duplicate,duplicateOf,duplicateConfidence",
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
    expect(t.targetAccountId).toBe("");
    expect(t.categoryId).toBe("");
    expect(t.categoryConfidence).toBe("");
  });
});

// ── startId option ────────────────────────────────────────────────

describe("startId option for multi-file append", () => {
  const mapping = baseMapping();

  it("IDs start from startId", () => {
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "A", Amount: "-1.00" }),
      makeRow({ Date: "2025-01-02", Description: "B", Amount: "-2.00" }),
    ];
    const result = transformCsv(rows, mapping, { startId: 50 });
    expect(result.transactions.map((t) => t.id)).toEqual(["imp-50", "imp-51"]);
  });

  it("defaults to 1 without option", () => {
    const rows = [makeRow({ Date: "2025-01-01", Description: "A", Amount: "-1.00" })];
    const result = transformCsv(rows, mapping);
    expect(result.transactions[0].id).toBe("imp-1");
  });

  it("skipped rows do not consume IDs with startId", () => {
    const mapping2 = baseMapping({ skipRules: [{ column: "Description", equals: "skip" }] });
    const rows = [
      makeRow({ Date: "2025-01-01", Description: "A", Amount: "-1.00" }),
      makeRow({ Date: "2025-01-02", Description: "skip", Amount: "-2.00" }),
      makeRow({ Date: "2025-01-03", Description: "B", Amount: "-3.00" }),
    ];
    const result = transformCsv(rows, mapping2, { startId: 100 });
    expect(result.transactions.map((t) => t.id)).toEqual(["imp-100", "imp-101"]);
  });
});
