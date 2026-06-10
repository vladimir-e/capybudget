/**
 * The three JSON schemas the orchestrator's stateless model calls are
 * constrained to, plus their parsed result types. Each is fed to
 * `StructuredSession.structured(messages, schema)` — the provider constrains
 * generation server-side and `parseStructured` validates the result, so a
 * malformed response throws rather than landing as a silently-wrong object.
 *
 *  1. mapping     — CSV headers + samples → a `CsvMapping`.
 *  2. extraction  — image/PDF bytes → `{ result: { rows } | { error: "no_data", … } }`.
 *  3. enrichBatch — ~25 rows + context → `{ id, merchant, category, … }[]`
 *                   (`category` is a name; `enrichBatch` maps it to an id).
 *  4. transfers   — transfer rows + direction-aware transfer context →
 *                   `{ id, account, confidence }[]` (`account` is a name the
 *                   model picks for the counterpart; mapped to an id).
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

/** Either a single named column or several joined by a separator. */
const COLUMN_REF_SCHEMA: JsonSchema = {
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
      properties: {
        columns: { type: "array", items: { type: "string" } },
        separator: { type: "string" },
      },
      required: ["columns"],
    },
  ],
};

/**
 * The mapping the model returns is ADVISORY, not authoritative —
 * `normalizeMapping` in `normalize.ts` is the sole authority that turns it into
 * a valid `CsvMapping`. Tolerance lives in two places that this schema keeps
 * intact: it carries NO enums (the model phrases `sign` and
 * `typeDetection.method` however it likes — they are plain strings the code
 * coerces) and requires only `amount` (the one role we can't synthesize — no
 * amount means it isn't a transaction file; date and description default in
 * code, so the mapping bends rather than breaks).
 *
 * What this schema does NOT loosen is *structure*. Anthropic's `output_config`
 * rejects any object without `additionalProperties: false`, so every object
 * here — top-level, nested, inside `anyOf`, and array `items` — sets it
 * explicitly and lists real-typed properties (mirroring `EXTRACTION_SCHEMA`).
 * The over-loosening that 400'd was structural (`{}` objects with no
 * `additionalProperties`); the loosening we actually need is value-level, above.
 *
 * `typeDetection.typeMap` is intentionally absent: an open-keyed map can't
 * satisfy `additionalProperties: false`, and `normalizeMapping` defaults
 * `typeDetection` without a model-provided map.
 */
export const CSV_MAPPING_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    headerRow: { type: "integer" },
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
            style: { type: "string" },
            column: { type: "string" },
            sign: { type: "string" },
          },
          required: ["column"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            style: { type: "string" },
            expenseColumn: { type: "string" },
            incomeColumn: { type: "string" },
          },
          required: ["expenseColumn", "incomeColumn"],
        },
      ],
    },
    typeDetection: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: { type: "string" },
        typeColumn: { type: "string" },
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
      anyOf: [...COLUMN_REF_SCHEMA.anyOf!, { type: "null" }],
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
 * Discriminated extraction outcome, wrapped in a `result` object. `{ count,
 * rows }` carries the same intermediate records the CSV mapper produces;
 * `{ error: "no_data" }` is the selfie case — the source has no transaction
 * data. The `anyOf` is wrapped because OpenAI strict rejects a bare top-level
 * `anyOf` root; the call site in `normalize.ts` unwraps `result`. Anthropic
 * accepts a root `anyOf` too, but the object-root form validates identically
 * for it.
 *
 * `count` is declared (and prompted) *before* `rows` so it streams first: the
 * model reads the whole document before emitting anything, so its declared
 * total gives the live extraction meter a denominator while rows stream. It's
 * advisory — the meter clamps, and completion comes from the phase, never
 * from `count` agreeing with `rows.length`.
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
            count: { type: "integer" },
            rows: { type: "array", items: STAGED_RECORD_SCHEMA },
          },
          required: ["count", "rows"],
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
  | { count: number; rows: StagedRecord[] }
  | { error: "no_data"; message: string };

/** What `EXTRACTION_SCHEMA` parses into — the discriminated outcome under the
 *  `result` wrapper the schema requires for OpenAI strict. */
export interface ExtractionEnvelope {
  result: ExtractionResult;
}

// ── 3. Enrichment batch ──────────────────────────────────────────

/**
 * The wire shape the classifier returns. The model reasons over category
 * *names*, never ids — `category` is a budget category name it picks from the
 * list in the prompt. `enrichBatch` maps that name → a `categoryId` (within the
 * row's type-appropriate categories) before handing back an `EnrichedRow`, so
 * the model never touches an opaque UUID.
 */
export interface EnrichedRowRaw {
  id: string;
  merchant: string;
  category: string;
  confidence: "high" | "low";
}

/** One enriched row `enrichBatch` returns, post name→id mapping. `id` ties it
 *  back to the staging row; `categoryId` is a resolved budget category id (or
 *  "" when the returned name didn't match a type-appropriate category). */
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
          category: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
        },
        required: ["id", "merchant", "category", "confidence"],
      },
    },
  },
  required: ["rows"],
};

export interface EnrichBatchResult {
  rows: EnrichedRowRaw[];
}

// ── 4. Transfer counterpart ──────────────────────────────────────

/**
 * The wire shape the transfer-counterpart call returns — a heterogeneous task
 * kept separate from `ENRICH_BATCH_SCHEMA` (transfers carry no merchant/category;
 * they only need their "From"/"To" account picked). The model reasons over
 * account *names*, never ids: `account` is a budget account name it chooses from
 * the row's transfer context, or `""` when unsure. `enrichTransfers` maps that
 * name → an `accountId`, validated against current accounts and never the row's
 * own — so the model never touches an opaque UUID.
 */
export interface TransferEnrichRaw {
  id: string;
  account: string;
  confidence: "high" | "low";
}

/** One resolved transfer counterpart `enrichTransfers` returns, post name→id
 *  mapping. `targetAccountId` is "" when the name didn't resolve to a valid,
 *  non-own account (or the model returned ""). */
export interface TransferEnriched {
  id: string;
  targetAccountId: string;
  confidence: "high" | "low";
}

export const ENRICH_TRANSFER_SCHEMA: JsonSchema = {
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
          account: { type: "string" },
          confidence: { type: "string", enum: ["high", "low"] },
        },
        required: ["id", "account", "confidence"],
      },
    },
  },
  required: ["rows"],
};

export interface TransferEnrichResult {
  rows: TransferEnrichRaw[];
}
