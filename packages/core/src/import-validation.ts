import type { ImportTransaction } from "./import-types";

export interface ValidationResult {
  valid: ImportTransaction[];
  warnings: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES = new Set(["expense", "income", "transfer"]);

/**
 * Validate AI-produced import transactions.
 * Drops rows that fail critical checks and auto-fixes minor issues.
 */
export function validateImportTransactions(
  raw: ImportTransaction[],
): ValidationResult {
  const valid: ImportTransaction[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const label = `Row ${i + 1}`;

    // Skip completely empty rows (all string fields empty and amount is 0 or NaN)
    const isEmpty =
      !row.id &&
      !row.date &&
      !row.description &&
      (row.amount === 0 || Number.isNaN(row.amount)) &&
      !row.type;
    if (isEmpty) continue;

    // Auto-fix: generate id if missing
    let fixedRow = { ...row };
    if (!fixedRow.id || fixedRow.id.trim() === "") {
      fixedRow = { ...fixedRow, id: crypto.randomUUID() };
      warnings.push(`${label}: missing id, auto-generated`);
    }

    // Critical: date must match YYYY-MM-DD
    if (!DATE_RE.test(fixedRow.date)) {
      warnings.push(`${label}: invalid date "${fixedRow.date}", row dropped`);
      continue;
    }

    // Critical: amount must be a finite integer
    if (!Number.isFinite(fixedRow.amount) || fixedRow.amount !== Math.trunc(fixedRow.amount)) {
      warnings.push(
        `${label}: invalid amount "${fixedRow.amount}", row dropped`,
      );
      continue;
    }

    // Critical: type must be one of the valid values
    if (!VALID_TYPES.has(fixedRow.type)) {
      warnings.push(`${label}: invalid type "${fixedRow.type}", row dropped`);
      continue;
    }

    valid.push(fixedRow);
  }

  return { valid, warnings };
}
