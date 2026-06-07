/**
 * The Categorizing phase's stateless model call + batching helpers.
 *
 * The classifier runs over the ambiguous remainder only — rows that fail the
 * `needsEnrich` predicate (fast-pathed, duplicate, hand-mapped, already
 * enriched) never reach here. Each batch is one tool-less `structured()` call
 * whose prompt embeds the rows, each row's distilled history context, and the
 * full category list (id + name) so the model can only return valid ids.
 *
 * Batches are independent and fail in isolation — a thrown call leaves its rows
 * incomplete (they still fail the predicate) and never poisons its siblings.
 * There is no auto-retry: the user-initiated idempotent re-run is the retry.
 */

import type { Category, ImportTransaction, RowContext } from "@capybudget/core";
import type { MessageContent } from "../types";
import type { StructuredSession } from "../structured";
import { ENRICH_BATCH_SCHEMA, type EnrichBatchResult, type EnrichedRow } from "./schemas";

/** Rows per enrichment batch. Bounded so each `structured()` call stays small —
 *  the token blowout the redesign kills came from unbounded row shuttling. */
export const ENRICH_BATCH_SIZE = 25;
/** Max batches dispatched concurrently. Caps in-flight token pressure. */
export const ENRICH_CONCURRENCY = 4;

/**
 * The enrichment gate. A row needs the classifier when it's missing either a
 * merchant or a category. Transfers are exempt — they carry no merchant/category
 * by design. A duplicate needs no separate case: grounding marks it complete
 * (both fields carried from the matched txn), so it already fails the
 * missing-field test. One predicate thus covers fast-pathed rows, duplicates,
 * hand-mapped rows, landed batches, and re-runs after a partial — resume +
 * re-run need no special-casing.
 */
export function needsEnrich(row: ImportTransaction): boolean {
  if (row.type === "transfer") return false;
  return !row.merchant || !row.categoryId;
}

/** Split rows into fixed-size batches. */
export function batchRows<T>(rows: T[], size = ENRICH_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}

/**
 * One enrichment batch — a single constrained call. Returns the classifier's
 * `{ id, merchant, categoryId, confidence }[]`, filtered to ids that are in the
 * batch and categoryIds that are valid budget categories (the model is
 * constrained to the list, but a stray id is dropped rather than written).
 *
 * Throws on a model/parse failure — the caller catches per-batch.
 */
export async function enrichBatch(
  session: StructuredSession,
  batch: ImportTransaction[],
  context: Record<string, RowContext>,
  categories: Category[],
): Promise<EnrichedRow[]> {
  const validCategoryIds = new Set(categories.map((c) => c.id));
  const prompt = buildEnrichPrompt(batch, context, categories);
  const messages: { role: "user"; content: MessageContent }[] = [{ role: "user", content: prompt }];

  const result = await session.structured<EnrichBatchResult>(messages, ENRICH_BATCH_SCHEMA);

  const batchIds = new Set(batch.map((r) => r.id));
  return result.rows.filter(
    (r) => batchIds.has(r.id) && (!r.categoryId || validCategoryIds.has(r.categoryId)),
  );
}

function buildEnrichPrompt(
  batch: ImportTransaction[],
  context: Record<string, RowContext>,
  categories: Category[],
): string {
  const categoryList = categories
    .map((c) => `${c.id}\t${c.name} (${c.group})`)
    .join("\n");

  const rows = batch.map((row) => {
    const ctx = context[row.id];
    return {
      id: row.id,
      description: row.description,
      amount: row.amount,
      type: row.type,
      sourceCategory: row.sourceCategory || undefined,
      history: ctx ? summarizeContext(ctx) : undefined,
    };
  });

  return [
    `Assign a clean merchant name and a budget category to each transaction below.`,
    ``,
    `Categories (id, name, group) — categoryId MUST be one of these ids:`,
    categoryList,
    ``,
    `Each row carries its raw description, and where available a "history" block: the user's own past transactions matching this description, plus how often each merchant/category appeared. When the history agrees, reuse that merchant name and categoryId — the user already settled on it. Otherwise clean the description into a merchant name (strip card prefixes, store numbers, city/state, reference numbers) and pick the best-fitting category.`,
    ``,
    `Set confidence "high" for an obvious match, "low" for a reasonable inference. Never leave categoryId empty — a low-confidence guess beats uncategorized.`,
    ``,
    `Rows:`,
    JSON.stringify(rows, null, 2),
  ].join("\n");
}

/** Distill a row's history context into compact prompt text — the top examples
 *  plus merchant/category frequency counts. Trims the sidecar to what the model
 *  needs without re-sending full transaction objects. */
function summarizeContext(ctx: RowContext) {
  return {
    examples: ctx.examples.map((e) => ({
      date: e.date,
      merchant: e.merchant,
      note: e.note,
      categoryId: e.categoryId,
    })),
    merchants: ctx.merchantStats.map((m) => `${m.name} (x${m.count})`),
    categories: ctx.categoryStats.map((c) => `${c.name} (x${c.count})`),
  };
}
