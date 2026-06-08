/**
 * The Categorizing phase's stateless model call + batching helpers. See
 * `specs/IMPORT.md` § Categorizing for the batched-classifier shape.
 *
 * Batches are independent and fail in isolation — a thrown call leaves its rows
 * incomplete (they still fail the `needsEnrich` predicate) and never poisons
 * its siblings. There is no auto-retry: the user-initiated idempotent re-run is
 * the retry.
 */

import type { Category, CategoryGroup, ImportTransaction, RowContext } from "@capybudget/core";
import type { MessageContent } from "../types";
import type { StructuredSession } from "../structured";
import { ENRICH_BATCH_SCHEMA, type EnrichBatchResult, type EnrichedRow } from "./schemas";

/** Rows per enrichment batch. Bounded so each `structured()` call stays small —
 *  the token blowout the redesign kills came from unbounded row shuttling. */
export const ENRICH_BATCH_SIZE = 25;
/** Max batches dispatched concurrently. Caps in-flight token pressure. */
export const ENRICH_CONCURRENCY = 4;

/**
 * The enrichment gate: `!duplicate && (!merchant || !categoryId)`. A row needs
 * the classifier when it isn't a duplicate and is missing either a merchant or a
 * category. Transfers are exempt — they carry no merchant/category by design.
 * Duplicates are excluded explicitly: a dup of an *uncategorized* historical txn
 * has no category to carry, so the missing-field test alone would re-feed it to
 * the model — the `duplicate` flag is what keeps it out. One predicate thus
 * covers fast-pathed rows, duplicates, hand-mapped rows, landed batches, and
 * re-runs after a partial — resume + re-run need no special-casing.
 */
export function needsEnrich(row: ImportTransaction): boolean {
  if (row.type === "transfer") return false;
  if (row.duplicate) return false;
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

/** A category is an income category iff it lives in the "Income" group; the
 *  other four groups are expense categories. */
function isIncomeCategory(group: CategoryGroup): boolean {
  return group === "Income";
}

/**
 * One enrichment batch — a single constrained call. The model reasons over
 * category *names* (it never sees a UUID); this function maps each returned
 * `category` name back to a `categoryId` and returns the
 * `{ id, merchant, categoryId, confidence }[]` the orchestrator expects,
 * restricted to ids that are in the batch (a stray id is dropped entirely).
 *
 * Name→id resolution is scoped to the row's *type-appropriate* categories: an
 * `income` row resolves only against Income-group names, an `expense` row only
 * against non-Income ones, matched case-insensitively and exactly. An unknown
 * or hallucinated name — or one that only exists in the wrong type — finds no id
 * and the row is left uncategorized (categoryId ""), so it keeps its cleaned
 * merchant and stays re-enrichable. Resolving within the type partition makes
 * writing an income category onto an expense structurally impossible.
 * (Transfers never reach here — `needsEnrich` exempts them.)
 *
 * Throws on a model/parse failure — the caller catches per-batch.
 */
export async function enrichBatch(
  session: StructuredSession,
  batch: ImportTransaction[],
  context: Record<string, RowContext>,
  categories: Category[],
): Promise<EnrichedRow[]> {
  const rowType = new Map(batch.map((r) => [r.id, r.type]));
  const idByName = nameToIdIndex(categories);
  const prompt = buildEnrichPrompt(batch, context, categories);
  const messages: { role: "user"; content: MessageContent }[] = [{ role: "user", content: prompt }];

  const result = await session.structured<EnrichBatchResult>(messages, ENRICH_BATCH_SCHEMA);

  return result.rows
    .filter((r) => rowType.has(r.id))
    .map((r) => {
      const income = rowType.get(r.id) === "income";
      const categoryId = idByName[income ? "income" : "expense"].get(r.category.trim().toLowerCase()) ?? "";
      return { id: r.id, merchant: r.merchant, categoryId, confidence: r.confidence };
    });
}

/** Case-insensitive name → id lookup, partitioned by type so a name can only
 *  resolve within the matching type. A duplicate name within a partition keeps
 *  the first (categories carry unique names in practice). */
function nameToIdIndex(categories: Category[]): { income: Map<string, string>; expense: Map<string, string> } {
  const income = new Map<string, string>();
  const expense = new Map<string, string>();
  for (const c of categories) {
    const target = isIncomeCategory(c.group) ? income : expense;
    const key = c.name.trim().toLowerCase();
    if (!target.has(key)) target.set(key, c.id);
  }
  return { income, expense };
}

function buildEnrichPrompt(
  batch: ImportTransaction[],
  context: Record<string, RowContext>,
  categories: Category[],
): string {
  const formatCategory = (c: Category) => `${c.name} (${c.group})`;
  const incomeCategories = categories.filter((c) => isIncomeCategory(c.group)).map(formatCategory).join("\n");
  const expenseCategories = categories.filter((c) => !isIncomeCategory(c.group)).map(formatCategory).join("\n");

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const rows = batch.map((row) => {
    const ctx = context[row.id];
    return {
      id: row.id,
      description: row.description,
      amount: row.amount,
      type: row.type,
      sourceCategory: row.sourceCategory || undefined,
      history: ctx ? summarizeContext(ctx, categoryName) : undefined,
    };
  });

  return [
    `Assign a clean merchant name and a budget category to each transaction below. Return the category by its exact NAME from the lists below.`,
    ``,
    `The category's type MUST match the transaction type: an \`income\` transaction takes an "Income"-group category; an \`expense\` takes a category from any non-Income group. The categories are split below by which type they apply to — pick from the matching list.`,
    ``,
    `Income categories (name, group) — use ONLY for \`income\` rows:`,
    incomeCategories,
    ``,
    `Expense categories (name, group) — use ONLY for \`expense\` rows:`,
    expenseCategories,
    ``,
    `PRIMARY SIGNAL — the user's own history. Each row may carry a "history" block: the user's past transactions matching this description, with each example's category and how often each merchant/category appeared. When the merchant appears in history, STRONGLY PREFER the category the user has used for it — weigh recency, frequency, and amount across the examples and counts. The user already settled on these; trust them over any other hint.`,
    ``,
    `\`sourceCategory\` is the bank's own coarse label. Treat it as a WEAK hint only — never let it override the user's history. A vague value like "Other" is NOT a category: do not map "Other" to "Other Income" or any category; ignore it and rely on history (or the description) instead.`,
    ``,
    `When history is absent or doesn't agree, clean the description into a merchant name (strip card prefixes, store numbers, city/state, reference numbers) and pick the best-fitting category by name.`,
    ``,
    `Set confidence "high" for an obvious match, "low" for a reasonable inference. Always return a category name from the matching list — a low-confidence guess beats leaving it blank.`,
    ``,
    `Rows:`,
    JSON.stringify(rows, null, 2),
  ].join("\n");
}

/** Distill a row's history context into compact prompt text — the top examples
 *  plus merchant/category frequency counts. Everything the model sees is by
 *  NAME: each example's and each stat's categoryId is resolved to its current
 *  category name, and any id with no current category (dead/archived) is dropped
 *  rather than rendered as "unknown", so the dominant signal stays a real,
 *  usable category. Empty example fields are already omitted upstream. */
function summarizeContext(ctx: RowContext, categoryName: Map<string, string>) {
  return {
    examples: ctx.examples.map((e) => {
      const name = e.categoryId ? categoryName.get(e.categoryId) : undefined;
      return {
        date: e.date,
        ...(e.merchant ? { merchant: e.merchant } : {}),
        ...(e.note ? { note: e.note } : {}),
        ...(name ? { category: name } : {}),
      };
    }),
    merchants: ctx.merchantStats.map((m) => `${m.name} (x${m.count})`),
    categoryCounts: ctx.categoryStats
      .map((c) => ({ name: categoryName.get(c.name), count: c.count }))
      .filter((c): c is { name: string; count: number } => c.name !== undefined)
      .map((c) => `${c.name} (x${c.count})`),
  };
}
