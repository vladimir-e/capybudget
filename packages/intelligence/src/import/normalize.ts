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
  buildCsvTable,
  buildStaged,
  detectHeaderRow,
  isViableHeaderRow,
  transformCsv,
  HEADER_SCAN_ROWS,
  SUPPORTED_DATE_FORMATS,
  type AmountMapping,
  type ColumnRef,
  type CsvMapping,
  type CsvTable,
  type ImportTransaction,
  type SingleAmountMapping,
  type SkipRule,
  type StagedRecord,
  type TransformError,
  type TypeDetection,
} from "@capybudget/core";
import type { MessageContent } from "../types";
import { SchemaValidationError, type StructuredSession } from "../structured";
import {
  CSV_MAPPING_SCHEMA,
  EXTRACTION_SCHEMA,
  type CsvMappingResult,
  type ExtractionEnvelope,
} from "./schemas";

/** Rows sampled from the source CSV head and shown to the mapper. */
const MAPPING_SAMPLE_ROWS = 20;
/** Rows the code-side preview transforms to surface mapping errors. */
const PREVIEW_ROWS = 15;

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
 * once on a malformed schema (the model named no usable amount column), and if
 * a code-side preview of the first rows then surfaces *transform* errors (a bad
 * column reference that still parsed as a schema), the model gets one more
 * correction round with those errors attached. Worst case is 2×2 = 4 mapping
 * calls; whatever the final round produces is final. Payloads are tiny (headers
 * + samples), so the bound is on correctness, not cost.
 */
export async function normalizeCsv(
  session: StructuredSession,
  source: { name: string; content: string },
  options: { startId?: number; importDate?: string } = {},
): Promise<NormalizeCsvResult> {
  // One raw parse (header: false) is the shared frame of reference: the header
  // detector, the prompt's numbered row listing, and the model's `headerRow`
  // override all index into this same blank-line-stripped grid.
  const grid = Papa.parse<string[]>(source.content, { header: false, skipEmptyLines: true }).data;
  const importDate = options.importDate ?? todayIso();

  let resolved = await resolveMapping(session, source.name, grid, detectHeaderRow(grid), importDate, null);

  // Code-side preview: transform a slice, and if it errors (e.g. the model named
  // a column that isn't there), give the model one correction round. The preview
  // is pure code — no model call to detect the problem, only to fix it. The
  // round-1 header pick is the correction round's baseline, so a mapping whose
  // only good part was relocating the header doesn't lose that on retry.
  const previewErrors = previewTransformErrors(resolved.table.rows.slice(0, PREVIEW_ROWS), resolved.mapping);
  if (previewErrors.length > 0) {
    resolved = await resolveMapping(session, source.name, grid, resolved.mapping.headerRow, importDate, previewErrors);
  }

  const { transactions, errors } = transformCsv(resolved.table.rows, resolved.mapping, {
    startId: options.startId,
  });
  return { rows: transactions, mapping: resolved.mapping, errors };
}

function previewTransformErrors(rows: Record<string, string>[], mapping: CsvMapping): string[] {
  try {
    const { errors } = transformCsv(rows, mapping);
    return errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}

/**
 * One mapping call → a guaranteed-valid `CsvMapping` plus the table it applies
 * to. The model's output is advisory and healed in code: `headerRow` stands
 * only when it survives `isViableHeaderRow` (else `headerPick` — code's
 * current pick — holds), and `normalizeMapping` heals every column-level field
 * against samples from the resulting table. The only failure mode is an amount
 * column that can't be identified at all (date and description default), which
 * `normalizeMapping` throws on — that gets one corrective retry before it
 * surfaces, so a transient bad response doesn't abort the import.
 */
async function resolveMapping(
  session: StructuredSession,
  filename: string,
  grid: string[][],
  headerPick: number,
  importDate: string,
  priorErrors: string[] | null,
): Promise<{ mapping: CsvMapping & { headerRow: number }; table: CsvTable }> {
  const prompt = buildMappingPrompt(filename, grid, headerPick, priorErrors);
  const heal = (raw: CsvMappingResult) => {
    const headerRow =
      typeof raw.headerRow === "number" && isViableHeaderRow(grid, raw.headerRow)
        ? raw.headerRow
        : headerPick;
    const table = buildCsvTable(grid, headerRow);
    const samples = table.rows.slice(0, MAPPING_SAMPLE_ROWS);
    return { mapping: { ...normalizeMapping(raw, samples, filename, importDate), headerRow }, table };
  };
  try {
    return heal(await callMapper(session, prompt));
  } catch (err) {
    if (!(err instanceof SchemaValidationError)) throw err;
    const retryPrompt = `${prompt}\n\nYour previous response could not be used: ${err.message}. Return a mapping that clearly identifies the amount column(s).`;
    return heal(await callMapper(session, retryPrompt));
  }
}

function buildMappingPrompt(
  filename: string,
  grid: string[][],
  headerPick: number,
  priorErrors: string[] | null,
): string {
  const { headers, rows } = buildCsvTable(grid, headerPick);
  const sample = rows.slice(0, MAPPING_SAMPLE_ROWS);
  const rawListing = grid
    .slice(0, HEADER_SCAN_ROWS)
    .map((cells, i) => `${i}: ${JSON.stringify(cells)}`)
    .join("\n");
  const errorNote =
    priorErrors && priorErrors.length > 0
      ? `\n\nYour previous mapping produced these transform errors. Correct it:\n${priorErrors
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
    `Sample rows (first ${sample.length}):`,
    JSON.stringify(sample, null, 2),
    `Identify the date column, the description column(s), and how amounts are structured: a single signed column ({ style: "single", column, sign }) or split debit/credit ({ style: "split", expenseColumn, incomeColumn }). Optionally include date.format, the source account, the source category column, and skipRules for non-transaction rows (opening balances, voids).`,
    `Determine the sign convention from the account type and the merchant context, not from a default. "sign" says which polarity is an expense: "negative_expense" (negatives are spending, positives are income — typical of bank/checking exports) or "positive_expense" (positives are spending — typical of CREDIT-CARD statements). On a credit-card statement such as Apple Card, purchases are POSITIVE and represent expenses, while NEGATIVE amounts are payments toward the card — treat those as transfers, not income. For split debit/credit columns, the outflow/debit column is expenses. Add transferPatterns for descriptions that name a card payment or account-to-account move (e.g. "Payment", "ACH Pmt", "Transfer") so they classify as transfers.`,
    `Guidance (the engine heals any deviation, so approximate freely): date.format like MM/DD/YYYY, YYYY-MM-DD, or DD.MM.YYYY. Amount formatting is read from the data, so don't worry about it.`,
    errorNote,
  ].join("\n");
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
 * valid value or defaulted. Amount is the only role that can fail (a file with
 * no amount column isn't a transaction file); date and description default —
 * date to an auto-detected column else the import date, description to empty.
 */
export function normalizeMapping(
  raw: CsvMappingResult,
  samples: Record<string, string>[],
  filename: string,
  importDate: string,
): CsvMapping {
  const amount = normalizeAmount(raw.amount, samples);
  return {
    date: normalizeDate(raw.date, samples, importDate),
    description: normalizeDescription(raw.description),
    amount,
    amountFormat: inferAmountFormat(amountSamples(samples, amount)),
    typeDetection: normalizeTypeDetection(raw.typeDetection),
    sourceAccount: normalizeSourceAccount(raw.sourceAccount, filename),
    sourceCategory: toColumnRef(raw.sourceCategory),
    skipRules: normalizeSkipRules(raw.skipRules),
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

function normalizeAmount(raw: unknown, samples: Record<string, string>[]): AmountMapping {
  const obj = isRecord(raw) ? raw : {};
  const expenseColumn = pickString(obj, ["expenseColumn", "debitColumn", "outflowColumn", "outflow", "debit"]);
  const incomeColumn = pickString(obj, ["incomeColumn", "creditColumn", "inflowColumn", "inflow", "credit"]);
  if (expenseColumn && incomeColumn) {
    return { style: "split", expenseColumn, incomeColumn };
  }
  const column =
    asString(raw) ?? pickString(obj, ["column", "amountColumn", "amount", "value"]) ?? detectAmountColumn(samples);
  if (!column) throw new SchemaValidationError("CSV mapping has no identifiable amount column");
  return { style: "single", column, sign: normalizeSign(obj.sign, samples, column) };
}

/**
 * Sign is genuine model judgment — it depends on account type and merchant
 * context (an Apple Card export reads positive purchases as expenses; a checking
 * export reads them as income), which the data can't reveal. So a model-provided
 * sign is authoritative and is never overridden by the data: any recognizable
 * phrasing is coerced to one of the two valid values. The data heuristic is the
 * last resort, reached only when the model offered no usable sign at all — a
 * column with negatives stores expenses as negatives; an all-positive column
 * reads as positive-expense.
 */
function normalizeSign(raw: unknown, samples: Record<string, string>[], column: string): SingleAmountMapping["sign"] {
  const coerced = coerceSign(typeof raw === "string" ? raw.toLowerCase() : "");
  if (coerced) return coerced;
  const hasNegative = columnSamples(samples, column).some((v) => /^[(-]/.test(v));
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

// ── Column auto-detection (when the model named no role) ─────────

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

/**
 * A column whose values read as money — preferring one with a clear monetary
 * signal (sign, cents, or currency symbol) over a bare-integer column that might
 * be an id. Date columns are excluded so a dotted European date isn't mistaken
 * for a number.
 */
function detectAmountColumn(samples: Record<string, string>[]): string | undefined {
  if (samples.length === 0) return undefined;
  const headers = Object.keys(samples[0]);
  const isNumeric = (header: string): boolean => {
    const values = columnSamples(samples, header);
    return values.length > 0 && values.every((v) => looksLikeAmount(v) && !looksLikeDate(v));
  };
  return (
    headers.find((h) => isNumeric(h) && columnSamples(samples, h).some(hasMoneySignal)) ??
    headers.find(isNumeric)
  );
}

function looksLikeAmount(value: string): boolean {
  const cleaned = value.replace(/[$€£¥₽₹₱₴₫₦₩₪₿()\s]/g, "");
  return /^[-+]?[\d.,]+$/.test(cleaned) && /\d/.test(cleaned);
}

function hasMoneySignal(value: string): boolean {
  return /[$€£¥₽₹₱₴₫₦₩₪₿]/.test(value) || /[.,]\d{2}\b/.test(value) || /^\s*[-+(]/.test(value);
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
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
  const columns =
    amount.style === "single" ? [amount.column] : [amount.expenseColumn, amount.incomeColumn];
  return samples
    .flatMap((row) => columns.map((c) => row[c] ?? ""))
    .filter((v) => v.trim() !== "");
}

/**
 * `1.234,56` (comma decimal) → european; a currency symbol or `1,234.56`
 * thousands grouping → currency; otherwise plain. European is checked first
 * because the comma-as-decimal is its defining trait even with a `€` present.
 */
function inferAmountFormat(values: string[]): CsvMapping["amountFormat"] {
  if (values.some((v) => /\d,\d{2}\b/.test(v) && !/\d\.\d{2}\b/.test(v))) {
    return { format: "european" };
  }
  if (
    values.some((v) => /[$€£¥₽₹₱₴₫₦₩₪₿]/.test(v) || /\d{1,3}(,\d{3})+/.test(v))
  ) {
    return { format: "currency" };
  }
  return { format: "plain" };
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

function accountFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || "Imported";
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
 * source with no transactions.
 */
export async function normalizeImage(
  session: StructuredSession,
  source: { name: string; content: string; mediaType: string },
  options: { startId?: number } = {},
): Promise<NormalizeImageResult> {
  const prompt = [
    `Read every transaction from this ${describeKind(source.mediaType)} (a receipt, bank screenshot, or statement scan) and return them as records.`,
    `For each transaction: date as YYYY-MM-DD, amount as signed integer cents (negative = money out, positive = money in), type (expense/income/transfer), the merchant or payee as "description", an inferred category as "sourceCategory" (empty string if none), and the account name as "sourceAccount" (empty string if none).`,
    `Never invent transactions — extract only what is visible. If the file contains no transaction data (e.g. a photo of a person, a logo, an unrelated document), return the no_data outcome with a short message.`,
  ].join("\n");

  const content: MessageContent = [
    { type: "text", text: prompt },
    sourceBlock(source),
  ];

  // EXTRACTION_SCHEMA wraps the discriminated outcome in `result` so its root is
  // an object (OpenAI strict rejects a bare top-level anyOf) — unwrap it here.
  const { result } = await session.structured<ExtractionEnvelope>(
    [{ role: "user", content }],
    EXTRACTION_SCHEMA,
  );

  if ("error" in result) {
    return { rows: [], noData: { message: result.message } };
  }

  // Defensive: the model can technically return `{ rows: [] }` — treat an empty
  // extraction as no_data so the orchestrator routes it to file-attach rather
  // than writing empty staging.
  if (result.rows.length === 0) {
    return { rows: [], noData: { message: "No transactions found in this file." } };
  }

  const records: StagedRecord[] = result.rows.map((r) => ({
    date: r.date,
    amount: r.amount,
    type: r.type,
    description: r.description,
    sourceAccount: r.sourceAccount,
    sourceCategory: r.sourceCategory,
  }));
  return { rows: buildStaged(records, { startId: options.startId }) };
}

function sourceBlock(source: { content: string; mediaType: string }) {
  if (source.mediaType === "application/pdf") {
    return {
      type: "document" as const,
      source: { type: "base64" as const, media_type: source.mediaType, data: source.content },
    };
  }
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: source.mediaType, data: source.content },
  };
}

function describeKind(mediaType: string): string {
  return mediaType === "application/pdf" ? "PDF" : "image";
}

/** Source files split into the two normalization paths by media type. */
export function isImageOrPdf(mediaType: string): boolean {
  return mediaType.startsWith("image/") || mediaType === "application/pdf";
}
