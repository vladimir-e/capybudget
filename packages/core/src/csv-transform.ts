/**
 * CSV Transform Engine
 *
 * Pure function: takes a CsvMapping + parsed CSV rows → ImportTransaction[].
 * Handles amount parsing, date normalization, type detection, skip rules.
 * Processes thousands of rows instantly — no AI in the loop.
 */

import type { ImportTransaction } from "./import-types";
import type {
  CsvMapping,
  ColumnRef,
  AmountMapping,
  AmountFormat,
  TypeDetection,
  SkipRule,
} from "./csv-mapping";

// ── Public API ──────────────────────────────────────────────────

export interface TransformResult {
  transactions: ImportTransaction[];
  errors: TransformError[];
  stats: {
    totalRows: number;
    transformed: number;
    skipped: number;
    errored: number;
  };
}

export interface TransformError {
  row: number;
  message: string;
  /** The raw row data for debugging. */
  rawValues?: Record<string, string>;
}

/**
 * Transform parsed CSV rows using a structured mapping.
 *
 * @param rows - Array of objects keyed by column header (e.g. from PapaParse)
 * @param mapping - The CsvMapping that defines how to interpret columns
 * @returns Transformed transactions + errors + stats
 */
export function transformCsv(
  rows: Record<string, string>[],
  mapping: CsvMapping,
): TransformResult {
  const transactions: ImportTransaction[] = [];
  const errors: TransformError[] = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1; // 1-indexed for user display

    // Check skip rules
    if (shouldSkipRow(row, mapping.skipRules)) {
      skipped++;
      continue;
    }

    try {
      const txn = transformRow(row, rowNum, mapping, transactions.length + 1);
      transactions.push(txn);
    } catch (e) {
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : String(e),
        rawValues: row,
      });
    }
  }

  return {
    transactions,
    errors,
    stats: {
      totalRows: rows.length,
      transformed: transactions.length,
      skipped,
      errored: errors.length,
    },
  };
}

// ── Row transformation ──────────────────────────────────────────

function transformRow(
  row: Record<string, string>,
  rowNum: number,
  mapping: CsvMapping,
  seqId: number,
): ImportTransaction {
  const date = parseDate(getColumn(row, mapping.date.column, rowNum), mapping.date.format, rowNum);
  const description = resolveColumnRef(row, mapping.description, rowNum);
  const { amount, isExpense } = parseAmount(row, mapping.amount, mapping.amountFormat, rowNum);
  const type = detectType(description, isExpense, mapping.typeDetection);
  const sourceAccount = resolveSourceAccount(row, mapping.sourceAccount, rowNum);
  const sourceCategory = mapping.sourceCategory
    ? resolveColumnRef(row, mapping.sourceCategory, rowNum)
    : "";
  const memo = mapping.memo ? resolveColumnRef(row, mapping.memo, rowNum) : "";
  const merchant = mapping.merchant ? resolveColumnRef(row, mapping.merchant, rowNum) : "";

  // Amount sign: outflow/expense negative, inflow/income positive (avoid -0)
  const signedAmount = amount === 0 ? 0 : isExpense ? -Math.abs(amount) : Math.abs(amount);

  return {
    id: `imp-${seqId}`,
    date,
    description,
    amount: signedAmount,
    type,
    sourceAccount,
    sourceCategory,
    memo,
    merchant,
    accountId: "",
    categoryId: "",
    categoryConfidence: "",
  };
}

// ── Column resolution ───────────────────────────────────────────

function getColumn(row: Record<string, string>, column: string, rowNum: number): string {
  const value = row[column];
  if (value === undefined) {
    throw new Error(`Row ${rowNum}: column "${column}" not found`);
  }
  return value.trim();
}

function resolveColumnRef(
  row: Record<string, string>,
  ref: ColumnRef,
  rowNum: number,
): string {
  if ("column" in ref && typeof ref.column === "string") {
    return getColumn(row, ref.column, rowNum);
  }
  if ("columns" in ref) {
    return ref.columns
      .map((col) => getColumn(row, col, rowNum))
      .filter((v) => v.length > 0)
      .join(ref.separator);
  }
  throw new Error(`Row ${rowNum}: invalid column reference`);
}

function resolveSourceAccount(
  row: Record<string, string>,
  ref: { column: string } | { literal: string },
  rowNum: number,
): string {
  if ("literal" in ref) return ref.literal;
  return getColumn(row, ref.column, rowNum);
}

// ── Date parsing ────────────────────────────────────────────────

const DATE_FORMATS: Record<string, (s: string) => string | null> = {
  "YYYY-MM-DD": (s) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  },
  "MM/DD/YYYY": (s) => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[1])}-${pad2(m[2])}` : null;
  },
  "DD/MM/YYYY": (s) => {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null;
  },
  "DD.MM.YYYY": (s) => {
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[2])}-${pad2(m[1])}` : null;
  },
  "MM-DD-YYYY": (s) => {
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    return m ? `${m[3]}-${pad2(m[1])}-${pad2(m[2])}` : null;
  },
  "YYYY/MM/DD": (s) => {
    const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  },
};

function pad2(s: string): string {
  return s.length === 1 ? `0${s}` : s;
}

function parseDate(value: string, format: string, rowNum: number): string {
  const parser = DATE_FORMATS[format];
  if (!parser) {
    throw new Error(`Row ${rowNum}: unsupported date format "${format}"`);
  }
  const result = parser(value);
  if (!result) {
    throw new Error(`Row ${rowNum}: cannot parse date "${value}" with format "${format}"`);
  }
  return result;
}

// ── Amount parsing ──────────────────────────────────────────────

interface ParsedAmount {
  /** Absolute amount in cents. */
  amount: number;
  /** Whether this looks like an expense based on the source data. */
  isExpense: boolean;
  /** Whether this looks like income based on the source data. */
  isIncome: boolean;
}

function parseAmount(
  row: Record<string, string>,
  amountMapping: AmountMapping,
  amountFormat: AmountFormat,
  rowNum: number,
): ParsedAmount {
  if (amountMapping.style === "single") {
    return parseSingleAmount(row, amountMapping.column, amountMapping.sign, amountFormat, rowNum);
  }
  return parseSplitAmount(
    row,
    amountMapping.expenseColumn,
    amountMapping.incomeColumn,
    amountFormat,
    rowNum,
  );
}

function parseSingleAmount(
  row: Record<string, string>,
  column: string,
  sign: "negative_expense" | "positive_expense",
  amountFormat: AmountFormat,
  rowNum: number,
): ParsedAmount {
  const raw = getColumn(row, column, rowNum);
  const cents = parseCurrencyToCents(raw, amountFormat.format, rowNum);

  const isExpense =
    sign === "negative_expense" ? cents < 0 : cents > 0;
  const isIncome =
    sign === "negative_expense" ? cents > 0 : cents < 0;

  return { amount: Math.abs(cents), isExpense, isIncome };
}

function parseSplitAmount(
  row: Record<string, string>,
  expenseCol: string,
  incomeCol: string,
  amountFormat: AmountFormat,
  rowNum: number,
): ParsedAmount {
  const rawExpense = getColumn(row, expenseCol, rowNum);
  const rawIncome = getColumn(row, incomeCol, rowNum);

  const expense = parseCurrencyToCents(rawExpense, amountFormat.format, rowNum);
  const income = parseCurrencyToCents(rawIncome, amountFormat.format, rowNum);

  if (expense !== 0 && income !== 0) {
    // Both columns have values — net them
    const net = income - expense;
    return {
      amount: Math.abs(net),
      isExpense: net < 0,
      isIncome: net >= 0,
    };
  }

  if (expense !== 0) {
    return { amount: Math.abs(expense), isExpense: true, isIncome: false };
  }

  if (income !== 0) {
    return { amount: Math.abs(income), isExpense: false, isIncome: true };
  }

  // Both zero — treat as zero-amount expense (e.g. balance adjustment)
  return { amount: 0, isExpense: true, isIncome: false };
}

/**
 * Parse a currency string into integer cents.
 *
 * Handles: "$1,234.56", "($50.00)", "-$50.00", "1234.56", "1.234,56" (European),
 * empty strings (→ 0), and bare "0.00" / "$0.00".
 */
export function parseCurrencyToCents(
  raw: string,
  format: "plain" | "currency" | "european",
  rowNum: number,
): number {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-") return 0;

  // Detect parenthesized negatives: ($123.45) or (123.45)
  let isNegative = false;
  let cleaned = trimmed;

  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    isNegative = true;
    cleaned = cleaned.slice(1, -1);
  }

  if (cleaned.startsWith("-")) {
    isNegative = true;
    cleaned = cleaned.slice(1);
  }

  // Strip currency symbols
  cleaned = cleaned.replace(/[$€£¥₽₹]/g, "").trim();

  if (cleaned === "" || cleaned === "0" || cleaned === "0.00" || cleaned === "0,00") return 0;

  let numeric: number;

  switch (format) {
    case "european": {
      // 1.234,56 → remove dot thousands separator, replace comma with dot
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
      numeric = parseFloat(cleaned);
      break;
    }
    case "currency":
    case "plain":
    default: {
      // 1,234.56 → remove comma thousands separator
      cleaned = cleaned.replace(/,/g, "");
      numeric = parseFloat(cleaned);
      break;
    }
  }

  if (!Number.isFinite(numeric)) {
    throw new Error(`Row ${rowNum}: cannot parse amount "${raw}"`);
  }

  const cents = Math.round(numeric * 100);
  return isNegative ? -cents : cents;
}

// ── Type detection ──────────────────────────────────────────────

function detectType(
  description: string,
  isExpense: boolean,
  detection: TypeDetection,
): "expense" | "income" | "transfer" {
  // Check transfer patterns first (for both "rules" and "amount_sign" with patterns)
  if (detection.transferPatterns && detection.transferPatterns.length > 0) {
    const descLower = description.toLowerCase();
    for (const pattern of detection.transferPatterns) {
      if (descLower.includes(pattern.toLowerCase())) {
        return "transfer";
      }
    }
  }

  if (detection.method === "column" && detection.typeColumn && detection.typeMap) {
    // Not implemented yet — would read from a column
    // For now fall through to amount-based
  }

  if (isExpense) return "expense";
  return "income";
}

// ── Skip rules ──────────────────────────────────────────────────

function shouldSkipRow(
  row: Record<string, string>,
  rules?: SkipRule[],
): boolean {
  if (!rules || rules.length === 0) return false;

  for (const rule of rules) {
    const value = (row[rule.column] ?? "").toLowerCase();
    if (rule.contains && value.includes(rule.contains.toLowerCase())) return true;
    if (rule.equals && value === rule.equals.toLowerCase()) return true;
  }

  return false;
}

// ── CSV serialization ───────────────────────────────────────────

const IMPORT_COLUMNS = [
  "id", "date", "description", "amount", "type",
  "sourceAccount", "sourceCategory", "memo",
  "merchant", "accountId", "categoryId", "categoryConfidence",
] as const;

/** Serialize ImportTransaction[] to a CSV string. */
export function serializeImportCsv(transactions: ImportTransaction[]): string {
  const header = IMPORT_COLUMNS.join(",");
  const rows = transactions.map((t) =>
    IMPORT_COLUMNS.map((col) => csvEscape(String(t[col] ?? ""))).join(","),
  );
  return [header, ...rows].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
