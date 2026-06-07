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
  buildStaged,
  transformCsv,
  type CsvMapping,
  type ImportTransaction,
  type StagedRecord,
  type TransformError,
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
 * CSV → staged rows. One mapping call, applied in code to every row. If a
 * preview of the first rows surfaces transform errors, the model gets one
 * correction round with the errors attached; whatever the second mapping
 * produces is final (no further loop).
 */
export async function normalizeCsv(
  session: StructuredSession,
  source: { name: string; content: string },
  options: { startId?: number } = {},
): Promise<NormalizeCsvResult> {
  const parsed = Papa.parse<Record<string, string>>(source.content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = parsed.meta.fields ?? [];
  const allRows = parsed.data;
  const sample = allRows.slice(0, MAPPING_SAMPLE_ROWS);

  let mapping = completeMapping(
    await requestMapping(session, source.name, headers, sample, null),
    sample,
    source.name,
  );

  // Code-side preview: transform a slice, and if it errors, give the model one
  // correction round. The preview is pure code — no model call to detect the
  // problem, only to fix it.
  const previewErrors = previewTransformErrors(allRows.slice(0, PREVIEW_ROWS), mapping);
  if (previewErrors.length > 0) {
    mapping = completeMapping(
      await requestMapping(session, source.name, headers, sample, previewErrors),
      sample,
      source.name,
    );
  }

  const { transactions, errors } = transformCsv(allRows, mapping, { startId: options.startId });
  return { rows: transactions, mapping, errors };
}

function previewTransformErrors(rows: Record<string, string>[], mapping: CsvMapping): string[] {
  try {
    const { errors } = transformCsv(rows, mapping);
    return errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.message}`);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}

async function requestMapping(
  session: StructuredSession,
  filename: string,
  headers: string[],
  sample: Record<string, string>[],
  priorErrors: string[] | null,
): Promise<CsvMappingResult> {
  const errorNote =
    priorErrors && priorErrors.length > 0
      ? `\n\nYour previous mapping produced these transform errors. Correct it:\n${priorErrors
          .map((e) => `- ${e}`)
          .join("\n")}`
      : "";

  const prompt = [
    `Map this CSV's columns so a transform engine can convert every row into a uniform transaction record.`,
    `File: ${filename}`,
    `Headers: ${headers.join(", ")}`,
    `Sample rows (first ${sample.length}):`,
    JSON.stringify(sample, null, 2),
    `Return a mapping describing the date column + format, the description column(s), how amounts are structured (single signed column or split debit/credit) and formatted, how to detect expense/income/transfer, the source account (a column or a literal inferred from the filename), and the source category column (or null if absent). Add skipRules for non-transaction rows (opening balances, voids) when present.`,
    `ALWAYS include date.format as a date pattern matching the sample dates (e.g. MM/DD/YYYY, YYYY-MM-DD, DD.MM.YYYY) — never omit it. Every field the schema marks required must be present in your response.`,
    errorNote,
  ].join("\n");

  try {
    return await callMapper(session, prompt);
  } catch (err) {
    // CSV_MAPPING_SCHEMA is non-strict (its open typeMap can't be expressed in
    // OpenAI strict), so the model can drop a required field and parseStructured
    // rejects it. Retry once with the validator's complaint attached.
    if (!(err instanceof SchemaValidationError)) throw err;
    const retryPrompt = `${prompt}\n\nYour previous response was rejected by validation: ${err.message}. Return the COMPLETE mapping with every required field present.`;
    return callMapper(session, retryPrompt);
  }
}

function callMapper(session: StructuredSession, prompt: string): Promise<CsvMappingResult> {
  const messages: { role: "user"; content: MessageContent }[] = [{ role: "user", content: prompt }];
  return session.structured<CsvMappingResult>(messages, CSV_MAPPING_SCHEMA);
}

/**
 * Fill any metadata field the model omitted, inferring it from the sample
 * values. The model only commits to the column roles (date column, description,
 * amount); reading `amountFormat`/`date.format` from the actual data is more
 * reliable than trusting the model, so a model-provided `date.format` wins but
 * an absent one is inferred rather than failing the whole import.
 */
export function completeMapping(
  mapping: CsvMappingResult,
  samples: Record<string, string>[],
  filename: string,
): CsvMapping {
  return {
    date: {
      column: mapping.date.column,
      format: mapping.date.format ?? inferDateFormat(columnSamples(samples, mapping.date.column)),
    },
    description: mapping.description,
    amount: mapping.amount,
    amountFormat: mapping.amountFormat ?? inferAmountFormat(amountSamples(samples, mapping.amount)),
    typeDetection: mapping.typeDetection ?? { method: "amount_sign" },
    sourceAccount: mapping.sourceAccount ?? { literal: accountFromFilename(filename) },
    sourceCategory: mapping.sourceCategory ?? null,
    skipRules: mapping.skipRules,
  };
}

function columnSamples(samples: Record<string, string>[], column: string): string[] {
  return samples.map((row) => row[column] ?? "").filter((v) => v.trim() !== "");
}

function amountSamples(samples: Record<string, string>[], amount: CsvMapping["amount"]): string[] {
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
