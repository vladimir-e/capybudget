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
 * One enrichment batch — a single constrained call. Returns the classifier's
 * `{ id, merchant, categoryId, confidence }[]`, restricted to ids that are in
 * the batch (a stray id is dropped entirely).
 *
 * A row's categoryId is kept only if it names a real budget category whose
 * *group* matches the row's `type`: an `income` row may take only an
 * Income-group category, an `expense` row only a non-Income one. An unknown id
 * or a type-mismatched one is cleared to empty — never written — so the row
 * keeps its cleaned merchant, stays uncategorized, and remains re-enrichable.
 * This makes writing an income category onto an expense structurally
 * impossible. (Transfers never reach here — `needsEnrich` exempts them.)
 *
 * Throws on a model/parse failure — the caller catches per-batch.
 */
export async function enrichBatch(
  session: StructuredSession,
  batch: ImportTransaction[],
  context: Record<string, RowContext>,
  categories: Category[],
): Promise<EnrichedRow[]> {
  const categoryGroup = new Map(categories.map((c) => [c.id, c.group]));
  const rowType = new Map(batch.map((r) => [r.id, r.type]));
  const prompt = buildEnrichPrompt(batch, context, categories);
  const messages: { role: "user"; content: MessageContent }[] = [{ role: "user", content: prompt }];

  const result = await session.structured<EnrichBatchResult>(messages, ENRICH_BATCH_SCHEMA);

  return result.rows
    .filter((r) => rowType.has(r.id))
    .map((r) => {
      const group = r.categoryId ? categoryGroup.get(r.categoryId) : undefined;
      const valid = group !== undefined && isIncomeCategory(group) === (rowType.get(r.id) === "income");
      return valid ? r : { ...r, categoryId: "" };
    });
}

function buildEnrichPrompt(
  batch: ImportTransaction[],
  context: Record<string, RowContext>,
  categories: Category[],
): string {
  const formatCategory = (c: Category) => `${c.id}\t${c.name} (${c.group})`;
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
    `Assign a clean merchant name and a budget category to each transaction below.`,
    ``,
    `categoryId's group MUST match the transaction type: an \`income\` transaction takes an "Income"-group category; an \`expense\` takes a category from any non-Income group. Never put an Income-group category on an expense. The categories are split below by which type they apply to — pick from the matching list.`,
    ``,
    `Income categories (id, name, group) — use ONLY for \`income\` rows:`,
    incomeCategories,
    ``,
    `Expense categories (id, name, group) — use ONLY for \`expense\` rows:`,
    expenseCategories,
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
 *  needs without re-sending full transaction objects. `categoryStats[].name`
 *  carries a categoryId (grounding counts by id); resolve it to its category
 *  name for the prompt, keeping the id so the model can reuse it directly. */
function summarizeContext(ctx: RowContext, categoryName: Map<string, string>) {
  return {
    examples: ctx.examples.map((e) => ({
      date: e.date,
      merchant: e.merchant,
      note: e.note,
      categoryId: e.categoryId,
    })),
    merchants: ctx.merchantStats.map((m) => `${m.name} (x${m.count})`),
    categoryCounts: ctx.categoryStats.map(
      (c) => `${categoryName.get(c.name) ?? "unknown"} [${c.name}] (x${c.count})`,
    ),
  };
}
