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
} from "@capybudget/core";
import type { MessageContent } from "../types";
import type { StructuredSession } from "../structured";
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

  let mapping = await requestMapping(session, source.name, headers, sample, null);

  // Code-side preview: transform a slice, and if it errors, give the model one
  // correction round. The preview is pure code — no model call to detect the
  // problem, only to fix it.
  const previewErrors = previewTransformErrors(allRows.slice(0, PREVIEW_ROWS), mapping);
  if (previewErrors.length > 0) {
    mapping = await requestMapping(session, source.name, headers, sample, previewErrors);
  }

  const { transactions } = transformCsv(allRows, mapping, { startId: options.startId });
  return { rows: transactions, mapping };
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
    errorNote,
  ].join("\n");

  const messages: { role: "user"; content: MessageContent }[] = [{ role: "user", content: prompt }];
  return session.structured<CsvMappingResult>(messages, CSV_MAPPING_SCHEMA);
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
