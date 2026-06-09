import { describe, it, expect } from "vitest";
import { detectHeaderRow, isViableHeaderRow, buildCsvTable } from "./csv-header";

/** A BofA-shaped grid: 5 narrow summary rows, then the real 4-column table
 *  (the blank line between them is already stripped by the parse). */
const BOFA_GRID: string[][] = [
  ["Description", "", "Summary Amt."],
  ["Beginning balance as of 02/03/2026", "", "1,131.74"],
  ["Total credits", "", "68,979.42"],
  ["Total debits", "", "-64,737.00"],
  ["Ending balance as of 06/08/2026", "", "5,374.16"],
  ["Date", "Description", "Amount", "Running Bal."],
  ["02/03/2026", "Beginning balance as of 02/03/2026", "", "1,131.74"],
  ["02/05/2026", "PAYPAL DES:INST XFER ID:COFFEE", "-120.54", "1,011.20"],
  ["02/06/2026", "Zelle payment from ALICE", "2,500.00", "3,511.20"],
  ["02/07/2026", "GROCERY OUTLET 0042", "-45.10", "3,466.10"],
];

describe("detectHeaderRow", () => {
  it("picks the real header past a BofA-style preamble", () => {
    // The preamble's matching-width run (4 summary rows) ties the table's
    // (4 data rows) — the dated transaction rows must break the tie.
    expect(detectHeaderRow(BOFA_GRID)).toBe(5);
  });

  it("picks row 0 for a clean no-preamble file", () => {
    const grid = [
      ["Date", "Description", "Amount"],
      ["2026-01-05", "COFFEE", "-4.50"],
      ["2026-01-06", "BAGEL", "-3.25"],
    ];
    expect(detectHeaderRow(grid)).toBe(0);
  });

  it("picks row 0 when every row has the same width (ties go earliest)", () => {
    const grid = Array.from({ length: 6 }, () => ["a", "b", "c"]);
    expect(detectHeaderRow(grid)).toBe(0);
  });

  it("returns 0 for an empty grid", () => {
    expect(detectHeaderRow([])).toBe(0);
  });
});

describe("isViableHeaderRow", () => {
  it("accepts the real header", () => {
    expect(isViableHeaderRow(BOFA_GRID, 5)).toBe(true);
  });

  it("rejects a row whose width the next row does not match", () => {
    expect(isViableHeaderRow(BOFA_GRID, 4)).toBe(false);
  });

  it("rejects the last row (nothing follows to be data)", () => {
    expect(isViableHeaderRow(BOFA_GRID, BOFA_GRID.length - 1)).toBe(false);
  });

  it("rejects out-of-range and non-integer indices", () => {
    expect(isViableHeaderRow(BOFA_GRID, 9999)).toBe(false);
    expect(isViableHeaderRow(BOFA_GRID, -1)).toBe(false);
    expect(isViableHeaderRow(BOFA_GRID, 1.5)).toBe(false);
  });
});

describe("buildCsvTable", () => {
  it("keys the rows below the chosen header by its cells", () => {
    const { headers, rows } = buildCsvTable(BOFA_GRID, 5);
    expect(headers).toEqual(["Date", "Description", "Amount", "Running Bal."]);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({
      Date: "02/05/2026",
      Description: "PAYPAL DES:INST XFER ID:COFFEE",
      Amount: "-120.54",
      "Running Bal.": "1,011.20",
    });
  });

  it("renames blank header cells positionally so they are addressable", () => {
    const { headers, rows } = buildCsvTable(
      [
        ["Date", "", "Amount"],
        ["2026-01-05", "COFFEE", "-4.50"],
      ],
      0,
    );
    expect(headers).toEqual(["Date", "Column 2", "Amount"]);
    expect(rows[0]["Column 2"]).toBe("COFFEE");
  });

  it("disambiguates duplicate header names, skipping taken suffixes", () => {
    expect(buildCsvTable([["Description", "Description", "Amount"]], 0).headers).toEqual([
      "Description",
      "Description 2",
      "Amount",
    ]);
    expect(buildCsvTable([["Description", "Description 2", "Description"]], 0).headers).toEqual([
      "Description",
      "Description 2",
      "Description 3",
    ]);
  });

  it("trims header cells", () => {
    expect(buildCsvTable([[" Date ", "Amount "]], 0).headers).toEqual(["Date", "Amount"]);
  });

  it("pads short data rows with empty strings and drops extra cells", () => {
    const { rows } = buildCsvTable([["A", "B"], ["1"], ["1", "2", "3"]], 0);
    expect(rows[0]).toEqual({ A: "1", B: "" });
    expect(rows[1]).toEqual({ A: "1", B: "2" });
  });

  it("returns an empty table for an empty grid", () => {
    expect(buildCsvTable([], 0)).toEqual({ headers: [], rows: [] });
  });
});
