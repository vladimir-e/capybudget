/**
 * The three JSON schemas the orchestrator's stateless model calls are
 * constrained to, plus their parsed result types. Each is fed to
 * `StructuredSession.structured(messages, schema)` — the provider constrains
 * generation server-side and `parseStructured` validates the result, so a
 * malformed response throws rather than landing as a silently-wrong object.
 *
 *  1. mapping     — CSV headers + samples → a `CsvMapping`.
 *  2. extraction  — image/PDF bytes → `{ rows } | { error: "no_data", … }`.
 *  3. enrichBatch — ~25 rows + context → `{ id, merchant, categoryId, … }[]`.
 *
 * Schemas mirror the `core` types they parse into (`CsvMapping`, `StagedRecord`)
 * — the validators live in `@capybudget/core`; these only describe the wire
 * shape the model must hit.
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

export const CSV_MAPPING_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    date: {
      type: "object",
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
          properties: {
            style: { type: "string", enum: ["single"] },
            column: { type: "string" },
            sign: { type: "string", enum: ["negative_expense", "positive_expense"] },
          },
          required: ["style", "column", "sign"],
        },
        {
          type: "object",
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
          properties: { column: { type: "string" } },
          required: ["column"],
        },
        {
          type: "object",
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
 * Discriminated extraction outcome. `{ rows }` carries the same intermediate
 * records the CSV mapper produces; `{ error: "no_data" }` is the selfie case —
 * the source has no transaction data. `anyOf` is the sole keyword at the node,
 * so the two alternatives are checked independently (see `structured.ts`).
 */
export const EXTRACTION_SCHEMA: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        rows: { type: "array", items: STAGED_RECORD_SCHEMA },
      },
      required: ["rows"],
    },
    {
      type: "object",
      properties: {
        error: { type: "string", enum: ["no_data"] },
        message: { type: "string" },
      },
      required: ["error", "message"],
    },
  ],
};

export type ExtractionResult =
  | { rows: StagedRecord[] }
  | { error: "no_data"; message: string };

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
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
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
