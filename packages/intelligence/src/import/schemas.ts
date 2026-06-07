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
 * Not strict: `typeDetection.typeMap` is an open-keyed `Record<string, …>`
 * (dynamic source values → our types), which OpenAI strict can't express —
 * strict forbids `additionalProperties` other than `false`, and an open map
 * has no fixed `properties`. Reshaping it into a strict-compatible array of
 * pairs would change `core`'s `CsvMapping` contract and its transform-engine
 * tests for the single, low-volume one-shot mapping call — not worth it when
 * the reliability win lives on the batch paths below. `parseStructured` stays
 * the backstop; both providers still honor the `additionalProperties: false`
 * markers as a best-effort constraint.
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
      required: ["column", "format"],
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
  required: [
    "date",
    "description",
    "amount",
    "amountFormat",
    "typeDetection",
    "sourceAccount",
    "sourceCategory",
  ],
};

export type CsvMappingResult = CsvMapping;

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
