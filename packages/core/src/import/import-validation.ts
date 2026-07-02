import { FALLBACK_SOURCE, type ImportTransaction } from "./import-types";

export interface ValidationResult {
  valid: ImportTransaction[];
  /** One note per row dropped by a critical check (invalid date/amount/type). */
  dropped: string[];
  /** One note per row auto-fixed in place (missing id backfilled). */
  fixed: string[];
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
  const dropped: string[] = [];
  const fixed: string[] = [];

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
      fixed.push(`${label}: missing id, auto-generated`);
    }

    // Auto-fix: an account-less row (no source name, no grounded account) heals
    // to the fallback source, so it shows in the mapping UI and merges like any
    // other unmapped source instead of slipping past the gate account-less.
    if (!fixedRow.sourceAccount && !fixedRow.accountId) {
      fixedRow = { ...fixedRow, sourceAccount: FALLBACK_SOURCE };
    }

    // Critical: date must match YYYY-MM-DD
    if (!DATE_RE.test(fixedRow.date)) {
      dropped.push(`${label}: invalid date "${fixedRow.date}", row dropped`);
      continue;
    }

    // Critical: amount must be a finite integer
    if (!Number.isFinite(fixedRow.amount) || fixedRow.amount !== Math.trunc(fixedRow.amount)) {
      dropped.push(`${label}: invalid amount "${fixedRow.amount}", row dropped`);
      continue;
    }

    // Critical: type must be one of the valid values
    if (!VALID_TYPES.has(fixedRow.type)) {
      dropped.push(`${label}: invalid type "${fixedRow.type}", row dropped`);
      continue;
    }

    valid.push(fixedRow);
  }

  return { valid, dropped, fixed };
}
