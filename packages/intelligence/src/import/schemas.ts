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
import type { CsvMapping, StagedRecord } from "@capybudget/core";

// ── 1. CSV mapping ───────────────────────────────────────────────

const COLUMN_REF_SCHEMA: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: { column: { type: "string" } },
      required: ["column"],
    },
    {
      type: "object",
      properties: {
        columns: { type: "array", items: { type: "string" } },
        separator: { type: "string" },
      },
      required: ["columns", "separator"],
    },
  ],
};

/**
 * The model commits only to the irreducible column ROLES — the date column, the
 * description column(s), and the amount structure. Everything else
 * (`date.format`, `amountFormat`, `typeDetection`, `sourceAccount`,
 * `sourceCategory`) is optional: `completeMapping` in `normalize.ts` infers any
 * the model omits from the sample values, which is more reliable than trusting
 * the model for derivable metadata (it can even get `amountFormat` wrong). So
 * `required` lists only those three roles — an omitted metadata field is
 * completed in code, never a hard validation failure.
 *
 * Also not strict: `typeDetection.typeMap` is an open-keyed `Record<string,…>`
 * (dynamic source values → our types), which OpenAI strict can't express —
 * strict forbids `additionalProperties` other than `false`, and an open map has
 * no fixed `properties`. `additionalProperties: false` stays as a best-effort
 * shape constraint both providers honor.
 */
export const CSV_MAPPING_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    date: {
      type: "object",
      additionalProperties: false,
      properties: {
        column: { type: "string" },
        format: { type: "string" },
      },
      required: ["column"],
    },
    description: COLUMN_REF_SCHEMA,
    amount: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            style: { type: "string", enum: ["single"] },
            column: { type: "string" },
            sign: { type: "string", enum: ["negative_expense", "positive_expense"] },
          },
          required: ["style", "column", "sign"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            style: { type: "string", enum: ["split"] },
            expenseColumn: { type: "string" },
            incomeColumn: { type: "string" },
          },
          required: ["style", "expenseColumn", "incomeColumn"],
        },
      ],
    },
    amountFormat: {
      type: "object",
      additionalProperties: false,
      properties: {
        format: { type: "string", enum: ["plain", "currency", "european"] },
      },
      required: ["format"],
    },
    typeDetection: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["amount_sign", "column", "rules"] },
        typeColumn: { type: "string" },
        typeMap: { type: "object" },
        transferPatterns: { type: "array", items: { type: "string" } },
      },
      required: ["method"],
    },
    sourceAccount: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { column: { type: "string" } },
          required: ["column"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: { literal: { type: "string" } },
          required: ["literal"],
        },
      ],
    },
    sourceCategory: {
      anyOf: [
        COLUMN_REF_SCHEMA,
        { type: "null" },
      ],
    },
    skipRules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          column: { type: "string" },
          contains: { type: "string" },
          equals: { type: "string" },
        },
        required: ["column"],
      },
    },
  },
  required: ["date", "description", "amount"],
};

/**
 * What the relaxed {@link CSV_MAPPING_SCHEMA} guarantees: the model commits to
 * the irreducible column roles, while the metadata fields are optional and
 * `completeMapping` fills any the model omits. Distinct from `core`'s
 * `CsvMapping` (which is always complete) — this is the raw, pre-completion
 * shape coming off the model.
 */
export type CsvMappingResult = {
  date: { column: string; format?: string };
  description: CsvMapping["description"];
  amount: CsvMapping["amount"];
  amountFormat?: CsvMapping["amountFormat"];
  typeDetection?: CsvMapping["typeDetection"];
  sourceAccount?: CsvMapping["sourceAccount"];
  sourceCategory?: CsvMapping["sourceCategory"];
  skipRules?: CsvMapping["skipRules"];
};

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
