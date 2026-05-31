import type { CsvMapping } from "./csv-mapping";

/** Minimal mapping for tests that only care about one aspect. */
export function baseMapping(overrides: Partial<CsvMapping> = {}): CsvMapping {
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

export function makeRow(fields: Record<string, string>): Record<string, string> {
  return fields;
}
