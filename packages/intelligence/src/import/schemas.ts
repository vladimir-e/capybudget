/**
 * The three JSON schemas the orchestrator's stateless model calls are
 * constrained to, plus their parsed result types. Each is fed to
 * `StructuredSession.structured(messages, schema)` — the provider constrains
 * generation server-side and `parseStructured` validates the result, so a
 * malformed response throws rather than landing as a silently-wrong object.
 *
 *  1. mapping     — CSV headers + samples → a `CsvMapping`.
 *  2. extraction  — image/PDF bytes → `{ result: { rows } | { error: "no_data", … } }`.
 *  3. enrichBatch — ~25 rows + context → `{ id, merchant, categoryId, … }[]`.
 *
 * Schemas mirror the `core` types they parse into (`CsvMapping`, `StagedRecord`)
 * — the validators live in `@capybudget/core`; these only describe the wire
 * shape the model must hit.
 *
 * `strict: true` on a schema asks the provider to *guarantee* on-schema output
 * (OpenAI `response_format.json_schema.strict`; Anthropic enforces the same
 * always). Strict requires every object to set `additionalProperties: false`
 * and list every property in `required`, with optionality expressed as a
 * `null`-union rather than omission. The two failure-prone, high-volume calls —
 * extraction and enrichment — opt in: best-effort output there means off-schema
 * rows, failed batches, and the retry cascade this redesign exists to kill.
 */

import type { JsonSchema } from "../structured";
import type { StagedRecord } from "@capybudget/core";

// ── 1. CSV mapping ───────────────────────────────────────────────

/**
 * The mapping the model returns is ADVISORY, not authoritative —
 * `normalizeMapping` in `normalize.ts` is the sole authority that turns it into
 * a valid `CsvMapping`. So this schema is a soft hint, never a rejection gate:
 * it carries NO enums (the model phrases values like `amountFormat` or `sign`
 * however it likes), leaves every value untyped (`{}` accepts anything), and
 * sets no `additionalProperties` (an unexpected extra key can't reject). The
 * only field required is `amount` — the one role we can't synthesize (no amount
 * means it isn't a transaction file). Date and description default in code (an
 * auto-detected column, else the import date / an empty string), so the mapping
 * bends rather than breaks. A wholly missing amount is still backstopped by a
 * one-shot retry before it surfaces. Shape guidance lives in the prompt.
 */
export const CSV_MAPPING_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    date: {},
    description: {},
    amount: {},
    amountFormat: {},
    typeDetection: {},
    sourceAccount: {},
    sourceCategory: {},
    skipRules: {},
  },
  required: ["amount"],
};

/**
 * The raw, advisory mapping coming off the model — deliberately untyped beyond
 * "a JSON object", because the model may phrase any value outside our
 * vocabulary or shape. `normalizeMapping` reads it defensively and is the sole
 * authority that produces a valid `core` `CsvMapping`.
 */
export type CsvMappingResult = Record<string, unknown>;

// ── 2. Image / PDF extraction ────────────────────────────────────

const STAGED_RECORD_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: { type: "string" },
    amount: { type: "integer" },
    type: { type: "string", enum: ["expense", "income", "transfer"] },
    description: { type: "string" },
    sourceAccount: { type: "string" },
    sourceCategory: { type: "string" },
  },
  required: ["date", "amount", "type", "description", "sourceAccount", "sourceCategory"],
};

/**
 * Discriminated extraction outcome, wrapped in a `result` object. `{ rows }`
 * carries the same intermediate records the CSV mapper produces; `{ error:
 * "no_data" }` is the selfie case — the source has no transaction data. The
 * `anyOf` is wrapped because OpenAI strict rejects a bare top-level `anyOf`
 * root; the call site in `normalize.ts` unwraps `result`. Anthropic accepts a
 * root `anyOf` too, but the object-root form validates identically for it.
 */
export const EXTRACTION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  strict: true,
  properties: {
    result: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            rows: { type: "array", items: STAGED_RECORD_SCHEMA },
          },
          required: ["rows"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            error: { type: "string", enum: ["no_data"] },
            message: { type: "string" },
          },
          required: ["error", "message"],
        },
      ],
    },
  },
  required: ["result"],
};

export type ExtractionResult =
  | { rows: StagedRecord[] }
  | { error: "no_data"; message: string };

/** What `EXTRACTION_SCHEMA` parses into — the discriminated outcome under the
 *  `result` wrapper the schema requires for OpenAI strict. */
export interface ExtractionEnvelope {
  result: ExtractionResult;
}

// ── 3. Enrichment batch ──────────────────────────────────────────

/** One enriched row the classifier returns. `id` ties it back to the staging
 *  row; `categoryId` must be one of the ids handed to the model. */
export interface EnrichedRow {
  id: string;
  merchant: string;
  categoryId: string;
  confidence: "high" | "low";
}

export const ENRICH_BATCH_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  strict: true,
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          merchant: { type: "string" },
          categoryId: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
        },
        required: ["id", "merchant", "categoryId", "confidence"],
      },
    },
  },
  required: ["rows"],
};

export interface EnrichBatchResult {
  rows: EnrichedRow[];
}
