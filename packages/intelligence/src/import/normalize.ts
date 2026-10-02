/**
 * The two stateless model-call functions for the Normalizing phase.
 *
 * Both converge on `buildStaged` — the CSV path applies a model-produced
 * `CsvMapping`, the image/PDF path emits the same intermediate records
 * directly. After this point no phase knows how a row was sourced.
 *
 * Each call is one constrained `structured()` round-trip: no agent loop, no
 * tools, no accumulated context. The CSV path adds one bounded re-call when a
 * code-side preview surfaces transform errors — the model gets the errors back
 * and corrects the mapping once. It never loops beyond that.
 */

import Papa from "papaparse";
import {
  amountColumns,
  buildCsvTable,
  buildStaged,
  decimalMarkOf,
  detectHeaderRow,
  getToday,
  isViableHeaderRow,
  parseAmountCell,
  shouldSkipRow,
  transformCsv,
  HEADER_SCAN_ROWS,
  SUPPORTED_DATE_FORMATS,
  type AmountMapping,
  type ColumnRef,
  type CsvMapping,
  type CsvTable,
  type DecimalMark,
  type ImportTransaction,
  type SingleAmountMapping,
  type SkipRule,
  type StagedRecord,
  type TransformError,
  type TypeDetection,
} from "@capybudget/core";
import type { MessageContent } from "../types";
import { sourceContentBlock } from "../source-files";
import { SchemaValidationError, type StructuredSession } from "../structured";
import type { NormalizeProgress } from "./events";
import {
  CSV_MAPPING_SCHEMA,
  EXTRACTION_SCHEMA,
  type CsvMappingResult,
  type ExtractionEnvelope,
} from "./schemas";

/** Rows sampled from the source CSV and shown to the mapper. */
const MAPPING_SAMPLE_ROWS = 20;
/** Rows the code-side preview transforms to surface mapping errors. */
const PREVIEW_ROWS = 15;

/**
 * Deterministic mapping sample: the table head plus rows evenly spaced across
 * the remainder (always including the last row). A head-only sample hides the
 * file's rarer shapes — the monthly card-payment/transfer row, a sign flip
 * later in the statement — so the model would write no `transferPatterns` for
 * them and the data heuristics would read a skewed slice. No randomness: the
 * same file always yields the same sample.
 */
function sampleRows<T>(rows: T[], count = MAPPING_SAMPLE_ROWS): T[] {
  if (rows.length <= count) return [...rows];
  const headCount = Math.floor(count / 2);
  const spreadCount = count - headCount;
  const span = rows.length - headCount;
  const spread = Array.from(
    { length: spreadCount },
    (_, i) => rows[headCount + Math.floor(((i + 1) * span) / spreadCount) - 1],
  );
  return [...rows.slice(0, headCount), ...spread];
}

export interface NormalizeCsvResult {
  rows: ImportTransaction[];
  mapping: CsvMapping;
  /** Rows the final transform couldn't parse (bad date/amount surviving the
   *  preview re-call). Dropped from `rows`; the orchestrator surfaces them as a
   *  warn-level log so the user sees what was skipped instead of it vanishing. */
  errors: TransformError[];
}

/**
 * CSV → staged rows. A mapping call is applied in code to every row. Two
 * bounded retry layers guard distinct failure modes: `resolveMapping` retries
 * once on an unusable mapping (off-schema output, or an amount
 * `normalizeMapping` refuses), and if a code-side preview of the first rows
 * then surfaces *transform* errors (a bad column reference, or non-transaction
 * rows the mapping doesn't skip), the model gets one more correction round with
 * those errors attached. Worst case is 2×2 = 4 mapping calls; whatever the
 * final round produces is final. Payloads are tiny (headers + samples), so the
 * bound is on correctness, not cost.
 */
export async function normalizeCsv(
  session: StructuredSession,
  source: { name: string; content: string },
  options: {
    startId?: number;
    importDate?: string;
    existingAccounts?: string[];
    /** Live progress for this file. The data-row count is known the moment the
     *  grid parses, so the meter gets its denominator while the mapping call
     *  (the slow part) runs; rows land all at once when the transform applies. */
    onProgress?: (progress: NormalizeProgress) => void;
  } = {},
): Promise<NormalizeCsvResult> {
  // One raw parse (header: false) is the shared frame of reference: the header
  // detector, the prompt's numbered row listing, and the model's `headerRow`
  // override all index into this same blank-line-stripped grid.
  const grid = Papa.parse<string[]>(source.content, { header: false, skipEmptyLines: true }).data;
  const importDate = options.importDate ?? getToday();

  const headerPick = detectHeaderRow(grid);
  options.onProgress?.({ rows: 0, total: Math.max(grid.length - headerPick - 1, 0) });

  const existingAccounts = options.existingAccounts ?? [];
  let resolved = await resolveMapping(session, source.name, grid, headerPick, importDate, existingAccounts, null);

  // Code-side preview: transform a slice, and if it errors (e.g. the model named
  // a column that isn't there), give the model one correction round. The preview
  // is pure code — no model call to detect the problem, only to fix it. The
  // round-1 header pick is the correction round's baseline, so a mapping whose
  // only good part was relocating the header doesn't lose that on retry.
  const previewErrors = previewTransformErrors(resolved.table.rows.slice(0, PREVIEW_ROWS), resolved.mapping);
  if (previewErrors.length > 0) {
    resolved = await resolveMapping(session, source.name, grid, resolved.mapping.headerRow, importDate, existingAccounts, previewErrors);
  }

  const { transactions, errors } = transformCsv(resolved.table.rows, resolved.mapping, {
    startId: options.startId,
  });
  // The mapping heal guarantees a non-empty *mapping*, but a mapped account
  // column can still hold blank cells — heal those per row, like the image
  // path, so no staged row leaves either normalizer account-less.
  const fallbackAccount = accountFromFilename(source.name);
  const rows = transactions.map((t) => (t.sourceAccount ? t : { ...t, sourceAccount: fallbackAccount }));
  return { rows, mapping: resolved.mapping, errors };
}

function previewTransformErrors(rows: Record<string, string>[], mapping: CsvMapping): string[] {
  try {
    const { errors } = transformCsv(rows, mapping);
    if (errors.length === 0) return [];
    return [...errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`), ...strayAmountNotes(rows, mapping)];
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}

function strayAmountNotes(rows: Record<string, string>[], mapping: CsvMapping): string[] {
  const kept = rows.filter((row) => !shouldSkipRow(row, mapping.skipRules));
  return amountColumns(mapping.amount).flatMap((column) => {
    const strays = acceptedStrays(kept, column)?.map((v) => JSON.stringify(truncateValue(v)));
    if (!strays?.length) return [];
    return [
      `"${column}" holds amounts apart from ${strays.join(", ")} — keep this column; add a skipRule for rows like ${strays[0]}`,
    ];
  });
}

/**
 * One mapping call → a guaranteed-valid `CsvMapping` plus the table it applies
 * to. The model's output is advisory and healed in code: `headerRow` stands
 * only when it survives `isViableHeaderRow` (else `headerPick` — code's
 * current pick — holds), and `normalizeMapping` heals every column-level field
 * against samples from the resulting table. Two failures surface as a
 * `SchemaValidationError`: output that isn't valid on-schema JSON, and an
 * amount `normalizeMapping` refuses (none named, half a debit/credit pair, a
 * single column named alongside debit/credit columns, a missing column, one
 * that isn't reliably amounts, or one blank in every sampled row).
 * Either gets one corrective retry carrying the error — for a refused amount,
 * the column listing to pick from — before it surfaces.
 */
async function resolveMapping(
  session: StructuredSession,
  filename: string,
  grid: string[][],
  headerPick: number,
  importDate: string,
  existingAccounts: string[],
  priorErrors: string[] | null,
): Promise<{ mapping: CsvMapping & { headerRow: number }; table: CsvTable }> {
  const prompt = buildMappingPrompt(filename, grid, headerPick, existingAccounts, priorErrors);
  const heal = (raw: CsvMappingResult) => {
    const headerRow =
      typeof raw.headerRow === "number" && isViableHeaderRow(grid, raw.headerRow)
        ? raw.headerRow
        : headerPick;
    const table = buildCsvTable(grid, headerRow);
    const samples = sampleRows(table.rows);
    return { mapping: { ...normalizeMapping(raw, samples, filename, importDate), headerRow }, table };
  };
  try {
    return heal(await callMapper(session, prompt));
  } catch (err) {
    if (!(err instanceof SchemaValidationError)) throw err;
    const retryPrompt = `${prompt}\n\nYour previous mapping could not be used: ${err.message}\nReturn a corrected mapping that names the amount column, or both the debit and credit columns, exactly as the headers list them.`;
    return heal(await callMapper(session, retryPrompt));
  }
}

/**
 * Shared grounding fragment for both normalizer prompts: the user's account
 * names (JSON-quoted, so commas or quotes in a name can't blur the list) plus
 * the exact-name rule. The trailing clause is the caller's — each prompt says
 * where the exact name goes.
 */
function existingAccountsClause(names: string[]): string {
  return `The user's existing accounts: ${names.map((n) => JSON.stringify(n)).join(", ")}. If the source clearly belongs to one of them (bank name, account type, last-4 digits, product names), use that account's EXACT name`;
}

function buildMappingPrompt(
  filename: string,
  grid: string[][],
  headerPick: number,
  existingAccounts: string[],
  priorErrors: string[] | null,
): string {
  const { headers, rows } = buildCsvTable(grid, headerPick);
  const sample = sampleRows(rows);
  const rawListing = grid
    .slice(0, HEADER_SCAN_ROWS)
    .map((cells, i) => `${i}: ${JSON.stringify(cells)}`)
    .join("\n");
  const accountsNote =
    existingAccounts.length > 0
      ? `${existingAccountsClause(existingAccounts)} as the literal source account.`
      : "";
  const errorNote =
    priorErrors && priorErrors.length > 0
      ? `\n\nYour previous mapping produced these transform errors. Correct it: add skipRules for non-transaction rows (pending, section, subtotal or repeated header lines).\n${priorErrors
          .map((e) => `- ${e}`)
          .join("\n")}`
      : "";

  return [
    `Map this CSV's columns so a transform engine can convert every row into a uniform transaction record.`,
    `File: ${filename}`,
    `Raw parsed rows, listed as "index: fields" (0-based indices; blank lines already removed):`,
    rawListing,
    `The engine reads row ${headerPick} as the table header and every row after it as data; rows before the header (bank summary preambles) are discarded. If the real header is a different row in the listing above, return "headerRow" with that row's index. Otherwise omit headerRow.`,
    `Headers (blank or duplicate cells renamed to stay addressable — use these names): ${headers.join(", ")}`,
    `Sample rows (${sample.length} of ${rows.length} data rows — the head plus rows spread across the file):`,
    JSON.stringify(sample, null, 2),
    `Identify the date column, the description column(s), and how amounts are structured: a single signed column ({ style: "single", column, sign }) or split debit/credit ({ style: "split", expenseColumn, incomeColumn }). Optionally include date.format, the source account, the source category column, and skipRules for non-transaction rows (opening balances, voids).`,
    `Always name the amount: the one column holding each transaction's amount in the account's currency, or BOTH the debit and credit columns. Foreign/original-currency amounts, exchange rates, fees, taxes, and running balances are never the amount. If no column holds it, omit amount rather than guess.`,
    accountsNote,
    `Determine the sign convention from the account type and the merchant context, not from a default. "sign" says which polarity is an expense: "negative_expense" (negatives are spending, positives are income — typical of bank/checking exports) or "positive_expense" (positives are spending — typical of CREDIT-CARD statements). On a credit-card statement such as Apple Card, purchases are POSITIVE and represent expenses, while NEGATIVE amounts are payments toward the card — treat those as transfers, not income. For split debit/credit columns, the outflow/debit column is expenses. Add transferPatterns for descriptions that name a card payment or account-to-account move (e.g. "Payment", "ACH Pmt", "Transfer") so they classify as transfers.`,
    `Guidance (the engine heals any deviation, so approximate freely): date.format like MM/DD/YYYY, YYYY-MM-DD, or DD.MM.YYYY. Amount formatting is read from the data, so don't worry about it.`,
    errorNote,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function callMapper(session: StructuredSession, prompt: string): Promise<CsvMappingResult> {
  const messages: { role: "user"; content: MessageContent }[] = [{ role: "user", content: prompt }];
  return session.structured<CsvMappingResult>(messages, CSV_MAPPING_SCHEMA);
}

/**
 * The sole authority that turns the model's loose, possibly-off mapping into a
 * guaranteed-valid `CsvMapping`. Column roles are read defensively (tolerating
 * synonyms and a bare-string form); every metadata field is healed — amount
 * formatting is always inferred from the data, and the rest is coerced to a
 * valid value or defaulted. Amount is the only role that can fail — it is never
 * guessed; date and description default — date to an auto-detected column else
 * the import date, description to empty.
 */
export function normalizeMapping(
  raw: CsvMappingResult,
  samples: Record<string, string>[],
  filename: string,
  importDate: string,
): CsvMapping {
  const skipRules = normalizeSkipRules(raw.skipRules);
  const amount = normalizeAmount(raw.amount, samples, skipRules);
  return {
    date: normalizeDate(raw.date, samples, importDate),
    description: normalizeDescription(raw.description),
    amount,
    decimalMark: inferDecimalMark(amountSamples(samples, amount)),
    typeDetection: normalizeTypeDetection(raw.typeDetection),
    sourceAccount: normalizeSourceAccount(raw.sourceAccount, filename),
    sourceCategory: toColumnRef(raw.sourceCategory),
    skipRules,
  };
}

// ── Defensive value readers ──────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** First key whose value is a non-empty string — tolerates synonym keys. */
function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(obj[key]);
    if (value) return value;
  }
  return undefined;
}

// ── Field normalizers ────────────────────────────────────────────

/**
 * Model's date column → else a column whose sample values parse as dates → else
 * a literal import date applied to every row. Never throws: a transaction
 * without an explicit date is still a transaction, just dated to the import.
 */
function normalizeDate(
  raw: unknown,
  samples: Record<string, string>[],
  importDate: string,
): CsvMapping["date"] {
  const obj = isRecord(raw) ? raw : {};
  const column = asString(raw) ?? pickString(obj, ["column", "dateColumn", "date"]);
  if (column) {
    const modelFormat = asString(obj.format);
    const format =
      modelFormat && SUPPORTED_DATE_FORMATS.includes(modelFormat)
        ? modelFormat
        : inferDateFormat(columnSamples(samples, column));
    return { column, format };
  }
  return detectDateColumn(samples) ?? { literal: importDate };
}

/** Yields "" for every row (resolveColumnRef joins an empty column list) — the
 *  default when the source has no description column. */
const EMPTY_DESCRIPTION: ColumnRef = { columns: [], separator: " " };

function normalizeDescription(raw: unknown): ColumnRef {
  return toColumnRef(raw) ?? EMPTY_DESCRIPTION;
}

/**
 * The amount role is the one place the mapping never guesses: a wrong column
 * is a silent money error, a refusal is a correction round and then a loud
 * failure. So the model must name one shape — a single column or a debit/credit
 * pair, never both — and the column(s) must exist and pass `acceptedStrays`.
 * Otherwise the error tells the model exactly what to fix, with every column's
 * sample values to pick from.
 */
function normalizeAmount(
  raw: unknown,
  samples: Record<string, string>[],
  skipRules: SkipRule[] | undefined,
): AmountMapping {
  const obj = isRecord(raw) ? raw : {};
  const expenseColumn = pickString(obj, ["expenseColumn", "debitColumn", "outflowColumn", "outflow", "debit"]);
  const incomeColumn = pickString(obj, ["incomeColumn", "creditColumn", "inflowColumn", "inflow", "credit"]);
  const column = asString(raw) ?? pickString(obj, ["column", "amountColumn", "amount", "value"]);
  const refuse = (problem: string): never => {
    throw new SchemaValidationError(`${problem}. ${describeColumns(samples)}`);
  };

  if (column && (expenseColumn || incomeColumn)) {
    const pair = [expenseColumn, incomeColumn].filter(Boolean).map((c) => `"${c}"`).join(" and ");
    refuse(
      `both a single amount column ("${column}") and debit/credit columns (${pair}) were named — name one signed amount column, or both the debit and credit columns, not both`,
    );
  }

  const rows = samples.filter((row) => !shouldSkipRow(row, skipRules));
  const amount: AmountMapping | null =
    expenseColumn && incomeColumn
      ? { style: "split", expenseColumn, incomeColumn }
      : column
        ? { style: "single", column, sign: normalizeSign(obj.sign, rows, column) }
        : null;
  if (!amount) {
    if (expenseColumn || incomeColumn) {
      const [side, named] = expenseColumn ? ["debit", expenseColumn] : ["credit", incomeColumn];
      refuse(
        `only the ${side} side ("${named}") was named — name both debit and credit columns, or a single signed amount column`,
      );
    }
    return refuse("no amount column named — name the column holding each transaction's amount, or both the debit and credit columns");
  }

  const columns = amountColumns(amount);
  const headers = samples.length > 0 ? Object.keys(samples[0]) : null;
  for (const c of columns) {
    if (headers && !headers.includes(c)) refuse(`column "${c}" does not exist`);
    if (!acceptedStrays(rows, c)) refuse(`column "${c}" does not hold amounts`);
  }
  if (rows.length > 0 && !columns.some((c) => columnSamples(rows, c).some((v) => /\d/.test(v)))) {
    refuse(`no sampled row has an amount in ${columns.map((c) => `"${c}"`).join(" or ")}`);
  }
  return amount;
}

const MAX_STRAY_VALUES = 2;

/**
 * A column holds amounts when at least 80% of its non-blank cells parse and the
 * rest come from at most two distinct values — real strays repeat (`PENDING`,
 * the header text, `VOID`), while a reference or memo column fails in many
 * different ways. Returns those distinct stray values, or null when the column
 * is refused.
 */
function acceptedStrays(rows: Record<string, string>[], column: string): string[] | null {
  const values = columnSamples(rows, column);
  const strays = values.filter((v) => parsedCell(v) === null);
  const distinct = [...new Set(strays.map((v) => v.trim()))];
  const mostlyParse = (values.length - strays.length) * 5 >= values.length * 4;
  return mostlyParse && distinct.length <= MAX_STRAY_VALUES ? distinct : null;
}

const DESCRIBED_COLUMNS = 30;
const DESCRIBED_VALUES = 3;
const DESCRIBED_VALUE_LENGTH = 24;

function describeColumns(samples: Record<string, string>[]): string {
  if (samples.length === 0) return "The file has no data rows.";
  const headers = Object.keys(samples[0]);
  const described = headers.slice(0, DESCRIBED_COLUMNS).map((header) => {
    const values = [...new Set(columnSamples(samples, header))].slice(0, DESCRIBED_VALUES).map(truncateValue);
    return `"${header}" (${values.length > 0 ? values.map((v) => JSON.stringify(v)).join(", ") : "blank"})`;
  });
  const more = headers.length > DESCRIBED_COLUMNS ? `, +${headers.length - DESCRIBED_COLUMNS} more` : "";
  return `Columns with sample values: ${described.join("; ")}${more}`;
}

function truncateValue(value: string): string {
  const v = value.trim();
  return v.length > DESCRIBED_VALUE_LENGTH ? `${v.slice(0, DESCRIBED_VALUE_LENGTH - 1)}…` : v;
}

/**
 * Sign is genuine model judgment — it depends on account type and merchant
 * context (an Apple Card export reads positive purchases as expenses; a checking
 * export reads them as income), which the data can't reveal. So a model-provided
 * sign is authoritative over the data heuristic: any recognizable phrasing is
 * coerced to one of the two valid values. The data heuristic is the last resort,
 * reached only when the model offered no usable sign at all — a column with
 * negatives stores expenses as negatives; an all-positive column reads as
 * positive-expense. One-sided direction markers are the exception, since they
 * do reveal it: a column of unsigned values marking only credits (`CR`) leaves
 * the unmarked ones as outflows, and one marking only debits leaves them inflows.
 * A single-letter marker is too easily a stray flag to drive that on its own.
 */
function normalizeSign(raw: unknown, samples: Record<string, string>[], column: string): SingleAmountMapping["sign"] {
  const cells = columnSamples(samples, column).flatMap((v) => parsedCell(v) ?? []);
  const hasNegative = cells.some((c) => c.cents < 0);
  const inflowMarked = cells.some((c) => c.direction === "inflow");
  const outflowMarked = cells.some((c) => c.direction === "outflow");
  const wordMarked = cells.some((c) => (c.marker?.length ?? 0) > 1);
  if (!hasNegative && wordMarked && inflowMarked !== outflowMarked) {
    return inflowMarked ? "positive_expense" : "negative_expense";
  }
  const coerced = coerceSign(typeof raw === "string" ? raw.toLowerCase() : "");
  if (coerced) return coerced;
  return hasNegative ? "negative_expense" : "positive_expense";
}

/**
 * Map the model's free-text sign onto the two valid values, reading the cue from
 * whichever polarity it names as spending: "positive"/"charge"/"credit" → spends
 * are positive; "negative"/"debit" → spends are negative. Returns null when the
 * string carries no usable signal, so the caller falls back to the data.
 */
function coerceSign(sign: string): SingleAmountMapping["sign"] | null {
  if (/positive|charge|credit/.test(sign)) return "positive_expense";
  if (/negative|debit/.test(sign)) return "negative_expense";
  return null;
}

const TYPE_METHODS = new Set<TypeDetection["method"]>(["amount_sign", "column", "rules"]);

function normalizeTypeDetection(raw: unknown): TypeDetection {
  const obj = isRecord(raw) ? raw : {};
  const method =
    typeof obj.method === "string" && TYPE_METHODS.has(obj.method as TypeDetection["method"])
      ? (obj.method as TypeDetection["method"])
      : "amount_sign";
  const result: TypeDetection = { method };
  const typeColumn = asString(obj.typeColumn);
  if (typeColumn) result.typeColumn = typeColumn;
  if (isRecord(obj.typeMap)) result.typeMap = obj.typeMap as TypeDetection["typeMap"];
  if (Array.isArray(obj.transferPatterns)) {
    const patterns = obj.transferPatterns.filter((p): p is string => typeof p === "string");
    if (patterns.length) result.transferPatterns = patterns;
  }
  return result;
}

function normalizeSourceAccount(raw: unknown, filename: string): CsvMapping["sourceAccount"] {
  const literal = asString(raw);
  if (literal) return { literal };
  if (isRecord(raw)) {
    const column = pickString(raw, ["column"]);
    if (column) return { column };
    const fromLiteral = pickString(raw, ["literal", "value", "name"]);
    if (fromLiteral) return { literal: fromLiteral };
  }
  return { literal: accountFromFilename(filename) };
}

// ── Date column auto-detection (when the model named none) ───────

/** A column whose every non-empty sample value parses as a supported date. */
function detectDateColumn(samples: Record<string, string>[]): CsvMapping["date"] | null {
  if (samples.length === 0) return null;
  for (const header of Object.keys(samples[0])) {
    const values = columnSamples(samples, header);
    if (values.length > 0 && values.every(looksLikeDate)) {
      return { column: header, format: inferDateFormat(values) };
    }
  }
  return null;
}

function looksLikeDate(value: string): boolean {
  const v = value.split(/[T ]/)[0];
  return /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(v) || /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(v);
}

function parsedCell(value: string): ReturnType<typeof parseAmountCell> | null {
  try {
    return parseAmountCell(value, ".", 0);
  } catch {
    return null;
  }
}

/** A `string`, `{ column }`, or `{ columns, separator }` → `ColumnRef`; else null. */
function toColumnRef(raw: unknown): ColumnRef | null {
  const single = asString(raw);
  if (single) return { column: single };
  if (isRecord(raw)) {
    const column = pickString(raw, ["column"]);
    if (column) return { column };
    if (Array.isArray(raw.columns)) {
      const columns = raw.columns.filter((c): c is string => typeof c === "string" && c.trim() !== "");
      if (columns.length) return { columns, separator: asString(raw.separator) ?? " " };
    }
  }
  return null;
}

function normalizeSkipRules(raw: unknown): SkipRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rules = raw.flatMap((entry): SkipRule[] => {
    if (!isRecord(entry)) return [];
    const column = pickString(entry, ["column"]);
    if (!column) return [];
    const rule: SkipRule = { column };
    const contains = asString(entry.contains);
    const equals = asString(entry.equals);
    if (contains) rule.contains = contains;
    if (equals) rule.equals = equals;
    return [rule];
  });
  return rules.length ? rules : undefined;
}

function columnSamples(samples: Record<string, string>[], column: string): string[] {
  return samples.map((row) => row[column] ?? "").filter((v) => v.trim() !== "");
}

function amountSamples(samples: Record<string, string>[], amount: AmountMapping): string[] {
  return amountColumns(amount).flatMap((c) => columnSamples(samples, c));
}

/** A vote over the values that prove a mark; a tie or no evidence → dot. */
function inferDecimalMark(values: string[]): DecimalMark {
  const marks = values.map(decimalMarkOf);
  const commas = marks.filter((m) => m === ",").length;
  const dots = marks.filter((m) => m === ".").length;
  return commas > dots ? "," : ".";
}

/**
 * Infer a `DATE_FORMATS`-supported pattern from the sample dates. ISO and dotted
 * forms are unambiguous; slash dates need disambiguation — a component >12 fixes
 * which side is the day, otherwise we default to US `MM/DD/YYYY`.
 */
function inferDateFormat(values: string[]): string {
  const dates = values.map((v) => v.split(/[T ]/)[0]).filter(Boolean);
  const first = dates[0] ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(first)) return "YYYY-MM-DD";
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(first)) return "YYYY/MM/DD";
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(first)) return "DD.MM.YYYY";
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(first)) return "MM-DD-YYYY";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(first)) return disambiguateSlashDate(dates);
  return "MM/DD/YYYY";
}

function disambiguateSlashDate(dates: string[]): "MM/DD/YYYY" | "DD/MM/YYYY" {
  for (const d of dates) {
    const m = d.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) return "DD/MM/YYYY"; // first component can't be a month
    if (Number(m[2]) > 12) return "MM/DD/YYYY"; // second component can't be the day
  }
  return "MM/DD/YYYY";
}

const FALLBACK_SOURCE = "Imported";

export function accountFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || FALLBACK_SOURCE;
}

export interface NormalizeImageResult {
  /** Empty when the outcome was `no_data`. */
  rows: ImportTransaction[];
  /** Set when the source carried no transaction data (the selfie case). */
  noData?: { message: string };
}

/**
 * Image/PDF → staged rows. Capy is the column-mapper for a column-less source:
 * it reads merchant → `description`, an inferred category → `sourceCategory`,
 * and emits the same intermediate records the CSV mapper produces, fed through
 * the same `buildStaged`. A discriminated outcome carries `no_data` for a
 * source with no transactions. A model-empty `sourceAccount` heals from the
 * filename — the same per-row fallback `normalizeCsv` applies after its
 * transform — so no normalizer emits a row without an account.
 */
export async function normalizeImage(
  session: StructuredSession,
  source: { name: string; content: string; mediaType: string },
  options: {
    startId?: number;
    existingAccounts?: string[];
    /** Live progress for this file, derived from the streamed response text:
     *  rows tick as records arrive, the total comes from the model-declared
     *  `count` once it streams (null before). Setting it makes the extraction
     *  call stream. */
    onProgress?: (progress: NormalizeProgress) => void;
  } = {},
): Promise<NormalizeImageResult> {
  const existingAccounts = options.existingAccounts ?? [];
  const accountsIntro =
    existingAccounts.length > 0
      ? `${existingAccountsClause(existingAccounts)} as "sourceAccount". Otherwise propose`
      : `For "sourceAccount", propose`;
  const prompt = [
    `Read every transaction from this ${describeKind(source.mediaType)} (a receipt, bank screenshot, or statement scan) and return them as records.`,
    `File: ${source.name}`,
    `Return "count" first — the total number of transactions you see — then the rows themselves.`,
    `For each transaction: date as YYYY-MM-DD, amount as signed integer cents (negative = money out, positive = money in), type (expense/income/transfer), the merchant or payee as "description", an inferred category as "sourceCategory" (empty string if none), and the account the transactions belong to as "sourceAccount".`,
    `${accountsIntro} a short descriptive account name from what is visible (e.g. "Chase Checking") or the filename. Never return an empty "sourceAccount" — if nothing identifies the account, use "${FALLBACK_SOURCE}".`,
    `When a row has no parseable date — the date column reads "Pending", or the source shows no dates — use today's date, ${getToday()}.`,
    `Never invent transactions — extract only what is visible. If the file contains no transaction data (e.g. a photo of a person, a logo, an unrelated document), return the no_data outcome with a short message.`,
  ].join("\n");

  const content: MessageContent = [
    { type: "text", text: prompt },
    sourceContentBlock(source),
  ];

  // EXTRACTION_SCHEMA wraps the discriminated outcome in `result` so its root is
  // an object (OpenAI strict rejects a bare top-level anyOf) — unwrap it here.
  const { onProgress } = options;
  const { result } = await session.structured<ExtractionEnvelope>(
    [{ role: "user", content }],
    EXTRACTION_SCHEMA,
    onProgress && { onText: (text) => onProgress(countStreamedRows(text)) },
  );

  if ("error" in result) {
    return { rows: [], noData: { message: result.message } };
  }

  // The model can return `{ rows: [] }` without the explicit no_data outcome;
  // map it to the same noData signal so an empty extraction is handled like a
  // declared no-data file — skipped with a warning when sibling files carry
  // rows, an empty completed preview when every file is empty.
  if (result.rows.length === 0) {
    return { rows: [], noData: { message: "No transactions found in this file." } };
  }

  const records: StagedRecord[] = result.rows.map((r) => ({
    date: r.date,
    amount: r.amount,
    type: r.type,
    description: r.description,
    sourceAccount: asString(r.sourceAccount) ?? accountFromFilename(source.name),
    sourceCategory: r.sourceCategory,
  }));
  return { rows: buildStaged(records, { startId: options.startId }) };
}

/**
 * Live meter signal parsed from the extraction call's streaming text. Rows are
 * counted by their `"date"` keys (one per record — no other schema field uses
 * the name); the denominator is the model-declared `count`, which the schema
 * orders before `rows` precisely so it streams first. Both reads tolerate a
 * half-written JSON prefix — this feeds a meter, not a parser, so a partial
 * `count` digit or a `"date"` mid-string merely flickers and self-corrects.
 */
export function countStreamedRows(text: string): NormalizeProgress {
  const rows = (text.match(/"date"\s*:/g) ?? []).length;
  const count = /"count"\s*:\s*(\d+)/.exec(text);
  return { rows, total: count ? Number(count[1]) : null };
}

function describeKind(mediaType: string): string {
  return mediaType === "application/pdf" ? "PDF" : "image";
}
