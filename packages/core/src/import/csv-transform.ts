/**
 * CSV Transform Engine
 *
 * Pure function: takes a CsvMapping + parsed CSV rows → ImportTransaction[].
 * Handles amount parsing, date normalization, type detection, skip rules.
 * Processes thousands of rows instantly — no AI in the loop.
 */

import type { ImportTransaction, StagedRecord } from "./import-types";
import { buildStaged } from "./build-staged";
import { DATE_FORMATS, isCalendarDate } from "./import-dates";
import { isCurrencyText, type AffixSide } from "./currency-text";
import type {
  CsvMapping,
  ColumnRef,
  AmountMapping,
  DecimalMark,
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
    held: number;
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
 * The CSV path is: apply the mapping → intermediate {@link StagedRecord}s →
 * {@link buildStaged}. The extraction path produces the same records and feeds
 * the same builder, so staging invariants live in one place.
 *
 * @param rows - Array of objects keyed by column header (e.g. from PapaParse)
 * @param mapping - The CsvMapping that defines how to interpret columns
 * @returns Transformed transactions + errors + stats
 */
export function transformCsv(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  options?: { startId?: number },
): TransformResult {
  const records: StagedRecord[] = [];
  const errors: TransformError[] = [];
  let skipped = 0;
  let held = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;

    const skipRule = matchingSkipRule(row, mapping.skipRules);
    if (skipRule && hasNoAmount(row, rowNum, mapping)) {
      skipped++;
      continue;
    }

    try {
      if (skipRule) {
        records.push({ ...mapRowToRecord(row, rowNum, heldRowMapping(row, mapping)), skipRule });
        held++;
      } else {
        records.push(mapRowToRecord(row, rowNum, mapping));
      }
    } catch (e) {
      errors.push({
        row: rowNum,
        message: e instanceof Error ? e.message : String(e),
        rawValues: row,
      });
    }
  }

  const transactions = buildStaged(records, { startId: options?.startId });

  return {
    transactions,
    errors,
    stats: {
      totalRows: rows.length,
      transformed: transactions.length,
      skipped,
      held,
      errored: errors.length,
    },
  };
}

// ── Row → intermediate record ───────────────────────────────────

function hasNoAmount(row: Record<string, string>, rowNum: number, mapping: CsvMapping): boolean {
  try {
    return parseAmount(row, mapping.amount, mapping.decimalMark, rowNum).amount === 0;
  } catch {
    return !amountColumns(mapping.amount).some((column) => /\d/.test(row[column] ?? ""));
  }
}

function heldRowMapping(row: Record<string, string>, mapping: CsvMapping): CsvMapping {
  const dateless = "column" in mapping.date && !(row[mapping.date.column] ?? "").trim();
  return dateless ? { ...mapping, date: { literal: "" } } : mapping;
}

function mapRowToRecord(
  row: Record<string, string>,
  rowNum: number,
  mapping: CsvMapping,
): StagedRecord {
  const date =
    "literal" in mapping.date
      ? mapping.date.literal
      : parseDate(getColumn(row, mapping.date.column, rowNum), mapping.date.format, rowNum);
  const description = resolveColumnRef(row, mapping.description, rowNum);
  const { amount, isExpense } = parseAmount(row, mapping.amount, mapping.decimalMark, rowNum);
  const type = detectType(row, description, isExpense, mapping.typeDetection);
  const sourceAccount = resolveSourceAccount(row, mapping.sourceAccount, rowNum);
  const sourceCategory = mapping.sourceCategory
    ? resolveColumnRef(row, mapping.sourceCategory, rowNum)
    : "";

  // Amount sign: outflow/expense negative, inflow/income positive (avoid -0)
  const signedAmount = amount === 0 ? 0 : isExpense ? -Math.abs(amount) : Math.abs(amount);

  return { date, amount: signedAmount, type, description, sourceAccount, sourceCategory };
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

function parseDate(value: string, format: string, rowNum: number): string {
  const parser = DATE_FORMATS[format];
  if (!parser) {
    throw new Error(`Row ${rowNum}: unsupported date format "${format}"`);
  }
  // Strip time portions (e.g. "2025-01-15T14:30:00" or "01/15/2025 10:00")
  const dateOnly = value.split(/[T ]/)[0];
  const result = parser(dateOnly);
  if (!result) {
    throw new Error(`Row ${rowNum}: cannot parse date "${value}" with format "${format}"`);
  }
  validateDate(result, value, rowNum);
  return result;
}

function validateDate(isoDate: string, rawValue: string, rowNum: number): void {
  if (!isCalendarDate(isoDate)) {
    throw new Error(`Row ${rowNum}: invalid date "${rawValue}" (parsed as ${isoDate})`);
  }
}

// ── Amount parsing ──────────────────────────────────────────────

type Direction = "inflow" | "outflow";

interface AmountCell {
  cents: number;
  direction: Direction | null;
  marker: string | null;
  currencyText: boolean;
}

function parseAmount(
  row: Record<string, string>,
  amountMapping: AmountMapping,
  decimalMark: DecimalMark,
  rowNum: number,
): { amount: number; isExpense: boolean } {
  const columns = amountColumns(amountMapping);
  const raws = columns.map((column) => getColumn(row, column, rowNum));
  const cells = raws.map((raw) => parseAmountCell(raw, decimalMark, rowNum));
  if (raws.every((raw) => !/\d/.test(raw))) {
    throw new Error(`Row ${rowNum}: no amount in ${columns.map((c) => `"${c}"`).join(" or ")}`);
  }

  if (amountMapping.style === "single") {
    const { cents, direction } = cells[0];
    const flow = direction
      ? directed(cents, direction)
      : amountMapping.sign === "negative_expense" ? cents : -cents;
    return { amount: Math.abs(flow), isExpense: flow < 0 };
  }

  const [expense, income] = cells;
  if (expense.cents === 0 && income.cents === 0) return { amount: 0, isExpense: true };
  const flow =
    directed(expense.cents, expense.direction ?? "outflow") +
    directed(income.cents, income.direction ?? "inflow");
  return { amount: Math.abs(flow), isExpense: flow < 0 };
}

export function amountColumns(mapping: AmountMapping): string[] {
  return mapping.style === "single" ? [mapping.column] : [mapping.expenseColumn, mapping.incomeColumn];
}

function directed(cents: number, direction: Direction): number {
  return direction === "outflow" ? -Math.abs(cents) : Math.abs(cents);
}

const AMOUNT_GROUPING = /[\s'’]/g;
const NUMERIC_CORE = /^(.*?)((?:(?<![\p{L}\p{M}/])[.,])?\d(?:[\d.,'’\s]*\d)?)(.*)$/su;
const AFFIX_TOKEN = /\s*(\p{L}[\p{L}\p{M}]*(?:\.\p{L}[\p{L}\p{M}]*)*[$/]?\.?|[\p{Sc}*.()+\-−△▲])\s*/uy;
const MINUS = ["-", "−", "△", "▲"];
const LEADING_ONLY_MINUS = ["△", "▲"];
const MARKERS: Record<string, Direction> = {
  C: "inflow",
  CR: "inflow",
  H: "inflow",
  D: "outflow",
  DB: "outflow",
  DR: "outflow",
  S: "outflow",
};

interface AmountParts {
  text: string;
  parts: { prefix: string; core: string; suffix: string } | null;
}

function splitAmount(raw: string): AmountParts {
  const text = raw.trim().replace(/^'/, "");
  const match = text.match(NUMERIC_CORE);
  return { text, parts: match && { prefix: match[1], core: match[2], suffix: match[3] } };
}

/**
 * The decimal mark a single amount proves on its own, or null when it can't.
 * `1.234` / `1,234` are ambiguous; `1234.567` and `0.500` are not.
 */
export function decimalMarkOf(raw: string): DecimalMark | null {
  const core = splitAmount(raw).parts?.core.replace(AMOUNT_GROUPING, "") ?? "";
  const marks = core.match(/[.,](?=\d)/g) as DecimalMark[] | null;
  if (!marks) return null;
  const last = marks[marks.length - 1];
  const other = last === "." ? "," : ".";
  if (marks.includes(other)) return last;
  if (marks.length > 1) return other;
  return /^[1-9]\d{0,2}[.,]\d{3}[.,]?$/.test(core) ? null : last;
}

/**
 * Parse a currency string into integer cents, signed from the user's
 * perspective (negative = outflow). `decimalMark` applies only when the value
 * doesn't prove its own. Throws on anything that isn't an amount.
 */
export function parseCurrencyToCents(raw: string, decimalMark: DecimalMark, rowNum: number): number {
  const { cents, direction } = parseAmountCell(raw, decimalMark, rowNum);
  return direction ? directed(cents, direction) : cents;
}

/** The cell's own signed cents plus any direction marker, before a column convention applies. */
export function parseAmountCell(raw: string, columnMark: DecimalMark, rowNum: number): AmountCell {
  const fail = (): never => {
    throw new Error(`Row ${rowNum}: cannot parse amount "${raw}"`);
  };
  const { text, parts } = splitAmount(raw);

  if (!parts) {
    const tokens = affixTokens(text) ?? fail();
    return tokens.some(isWord) ? fail() : { cents: 0, direction: null, marker: null, currencyText: tokens.some(isSymbol) };
  }

  const prefix = affixTokens(parts.prefix) ?? fail();
  const suffix = affixTokens(parts.suffix) ?? fail();
  const sign = readSign(prefix, suffix) ?? fail();
  const magnitude = coreToCents(parts.core, decimalMarkOf(parts.core) ?? columnMark) ?? fail();
  const cents = magnitude === 0 ? 0 : sign.negative ? -magnitude : magnitude;
  const currencyText = [...prefix, ...suffix].some((t) => isSymbol(t) || (isWord(t) && !markerOf(t)));
  return { cents, direction: sign.marker ? MARKERS[sign.marker] : null, marker: sign.marker, currencyText };
}

function affixTokens(text: string): string[] | null {
  const tokens: string[] = [];
  const trimmed = text.trim();
  AFFIX_TOKEN.lastIndex = 0;
  while (AFFIX_TOKEN.lastIndex < trimmed.length) {
    const token = AFFIX_TOKEN.exec(trimmed);
    if (!token) return null;
    tokens.push(token[1]);
  }
  return tokens;
}

function isWord(token: string): boolean {
  return /^\p{L}/u.test(token);
}

function isSymbol(token: string): boolean {
  return /^\p{Sc}$/u.test(token);
}

function markerOf(word: string): string | undefined {
  const marker = word.replace(/\.$/, "").toUpperCase();
  return marker in MARKERS ? marker : undefined;
}

function readSign(
  prefix: string[],
  suffix: string[],
): { negative: boolean; marker: string | null } | null {
  const tokens = [...prefix, ...suffix];
  const count = (...symbols: string[]) => tokens.filter((t) => symbols.includes(t)).length;
  const known = (side: AffixSide) => (t: string) => !isWord(t) || !!markerOf(t) || isCurrencyText(t, side);
  if (!prefix.every(known("prefix")) || !suffix.every(known("suffix"))) return null;
  if (suffix.some((t) => LEADING_ONLY_MINUS.includes(t))) return null;

  const markers = tokens.filter(isWord).flatMap((w) => markerOf(w) ?? []);
  const parens = prefix.includes("(") && suffix.includes(")");
  const signs = count(...MINUS, "+");
  if (count("(") + count(")") !== (parens ? 2 : 0)) return null;
  if (signs > 1 || markers.length > 1) return null;
  if (markers.length === 1 && (signs > 0 || parens)) return null;

  return {
    negative: parens || count(...MINUS) > 0,
    marker: markers[0] ?? null,
  };
}

function coreToCents(core: string, decimalMark: DecimalMark): number | null {
  const parts = core.split(decimalMark);
  if (parts.length > 2) return null;
  const [integer, fraction = ""] = parts;
  if (!/^\d*$/.test(fraction)) return null;
  if (!/^\d*$/.test(integer) && !isGrouped(integer.replace(/\D/g, ","))) return null;
  const digits = integer.replace(/\D/g, "");
  if (digits === "" && fraction === "") return null;
  return Math.round(Number(`${digits || "0"}.${fraction || "0"}`) * 100);
}

function isGrouped(integer: string): boolean {
  return /^\d{1,3}(,\d{3})+$/.test(integer) || /^\d{1,2}(,\d{2})+,\d{3}$/.test(integer);
}

// ── Type detection ──────────────────────────────────────────────

/**
 * High-confidence transfer phrases checked on every row, independent of the
 * model-supplied `transferPatterns`. Each phrase is multi-word and anchored —
 * "transfer" paired with account context, so a merchant that merely contains
 * the word (e.g. "Transferwise", "Money Transfer Inc") does not false-match,
 * or a bank's fixed payment phrasing ("payment to crd" is BofA's wording for
 * intra-bank card payments). The model's patterns are still checked additively
 * to catch bank-specific phrasings these miss.
 */
export const DEFAULT_TRANSFER_PATTERNS: readonly string[] = [
  "internet transfer",
  "online transfer",
  "mobile transfer",
  "wire transfer",
  "ach transfer",
  "bank transfer",
  "online banking transfer",
  "transfer from account",
  "transfer to account",
  "transfer from checking",
  "transfer from savings",
  "transfer to checking",
  "transfer to savings",
  "payment to crd",
];

function detectType(
  row: Record<string, string>,
  description: string,
  isExpense: boolean,
  detection: TypeDetection,
): "expense" | "income" | "transfer" {
  // Check transfer patterns first — cross-cutting concern for all methods.
  // Built-in defaults always run so unambiguous transfers don't depend on the
  // model having supplied a matching pattern; the model's patterns are additive.
  const descLower = description.toLowerCase();
  const patterns = [...DEFAULT_TRANSFER_PATTERNS, ...(detection.transferPatterns ?? [])];
  for (const pattern of patterns) {
    if (descLower.includes(pattern.toLowerCase())) {
      return "transfer";
    }
  }

  // Column-based: read the type directly from a source column
  if (detection.method === "column" && detection.typeColumn && detection.typeMap) {
    const val = (row[detection.typeColumn] ?? "").trim().toLowerCase();
    const mapped = detection.typeMap[val];
    if (mapped) return mapped;
    // Unknown value → fall through to amount-sign as graceful degradation
  }

  return isExpense ? "expense" : "income";
}

// ── Skip rules ──────────────────────────────────────────────────

function matchingSkipRule(
  row: Record<string, string>,
  rules?: SkipRule[],
): SkipRule | null {
  for (const rule of rules ?? []) {
    const value = (row[rule.column] ?? "").toLowerCase();
    if (rule.contains && value.includes(rule.contains.toLowerCase())) return rule;
    if (rule.equals && value === rule.equals.toLowerCase()) return rule;
  }
  return null;
}

export function shouldSkipRow(
  row: Record<string, string>,
  rules?: SkipRule[],
): boolean {
  return matchingSkipRule(row, rules) !== null;
}

// ── CSV serialization ───────────────────────────────────────────

const IMPORT_COLUMNS = [
  "id", "date", "description", "amount", "type",
  "sourceAccount", "sourceCategory",
  "merchant", "accountId", "targetAccountId", "categoryId", "categoryConfidence",
  "duplicate", "duplicateConfidence", "skipRule",
] as const;

/** Serialize ImportTransaction[] to a CSV string. */
export function serializeImportCsv(transactions: ImportTransaction[]): string {
  const header = IMPORT_COLUMNS.join(",");
  const rows = transactions.map((t) =>
    IMPORT_COLUMNS.map((col) => csvEscape(cellText(t, col))).join(","),
  );
  return [header, ...rows].join("\n");
}

function cellText(t: ImportTransaction, col: (typeof IMPORT_COLUMNS)[number]): string {
  if (col === "skipRule") return t.skipRule ? JSON.stringify(t.skipRule) : "";
  return String(t[col] ?? "");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
