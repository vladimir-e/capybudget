/**
 * Deterministic grounding — the heart of the import redesign.
 *
 * Code pre-computes every groundable signal so the AI classifier handles only
 * the ambiguous remainder. For each staged row this:
 *   1. fuzzy-matches the trimmed description against the user's merchant + note
 *      history (pre-indexed once per run),
 *   2. attaches the top-3 most-recent examples + distilled merchant/category
 *      stats (the context sidecar),
 *   3. folds in `sourceAccount`→account matching,
 *   4. fast-paths rows whose history signal is strong + near-unanimous (assigns
 *      merchant + categoryId in code, confidence `high`),
 *   5. folds in duplicate detection — accurate dups are marked complete and
 *      flagged to skip enrichment.
 *
 * The bank's coarse `sourceCategory` is never turned into a category here — it
 * survives only as a weak hint in the enrichment prompt, so the model decides.
 * Deterministic history assignments (fast-path, dup-carry) are type-guarded:
 * an expense never inherits an Income-group category, even from miscategorized
 * history, and vice versa.
 *
 * Pure: callers pass history/accounts/categories in; nothing here touches files.
 */

import type { Account, Category, Transaction } from "../entities/types";
import type { ImportTransaction } from "./import-types";
import {
  HistoryIndex,
  buildMatchQuery,
  type HistoryMatch,
  type HistoryIndexOptions,
} from "./import-history-index";
import { matchAccountsByName } from "./import-matching";
import {
  detectDuplicates,
  type DuplicateMatch,
} from "./import-duplicates";

// ── Tunable thresholds ───────────────────────────────────────────

/** Fast-path needs at least this many historical matches. */
export const FAST_PATH_MIN_MATCHES = 3;
/** …and at least this share agreeing on a single category. */
export const FAST_PATH_CATEGORY_AGREEMENT = 0.8;
/** How many example transactions the context sidecar carries per row. */
export const CONTEXT_EXAMPLE_COUNT = 3;

// ── Output types ─────────────────────────────────────────────────

/** One historical example surfaced to the classifier for a row. Empty
 *  fields are omitted at the source (`buildContext`) rather than carried as
 *  `""` — an absent field means "not set", which keeps `context.json` and the
 *  enrichment prompt lean and stops the model over-reading empty strings. */
export interface GroundingExample {
  date: string;
  merchant?: string;
  note?: string;
  categoryId?: string;
  amount: number;
}

/** A distilled count, e.g. `Ginger (x2)` or `Rent (x22)`. */
export interface NameCount {
  name: string;
  count: number;
}

/**
 * Per-row history signal — ephemeral classifier input, persisted to
 * `context.json` by the orchestrator (Unit 2), never a staging column.
 */
export interface RowContext {
  examples: GroundingExample[];
  /** Merchant text counts among matches (canonical merchant first). */
  merchantStats: NameCount[];
  /** Category id counts among matches. */
  categoryStats: NameCount[];
}

export type Resolution = "fast-path" | "duplicate" | "ambiguous";

/**
 * Per-row grounding result. Carries the fields the orchestrator writes back to
 * staging. `resolution` discriminates how far code got:
 *   - `duplicate`  — matches an existing budget txn; skip enrichment.
 *   - `fast-path`  — strong, near-unanimous history → merchant + category set.
 *   - `ambiguous`  — needs the classifier; `RowContext` carries the signal.
 */
export interface GroundingResult {
  rowId: string;
  resolution: Resolution;
  /** Cleaned merchant (fast-path / duplicate), else "". */
  merchant: string;
  /** Resolved categoryId, else "". */
  categoryId: string;
  /** "high" when fast-pathed or deduped with a category, else "". */
  categoryConfidence: "high" | "low" | "";
  /** Resolved budget accountId (sourceAccount match), else "". */
  accountId: string;
  /** For a transfer: the suggested counterpart ("From account"), resolved from
   *  matching historical transfer legs. "" for non-transfers or no signal. */
  targetAccountId: string;
  /** True when the row duplicates an existing budget transaction. */
  duplicate: boolean;
  /** The dup it matched, when `duplicate`. */
  duplicateMatch?: DuplicateMatch;
}

export interface GroundingStats {
  total: number;
  resolved: number;
  duplicates: number;
  fastPathed: number;
  ambiguous: number;
}

export interface GroundingOutcome {
  results: Map<string, GroundingResult>;
  /** Context sidecar, keyed by row id. */
  context: Map<string, RowContext>;
  stats: GroundingStats;
}

export interface GroundImportInput {
  rows: ImportTransaction[];
  history: Transaction[];
  accounts: Account[];
  categories: Category[];
  /** sourceAccount → accountId | "__create__" aliases, pre-resolves accounts. */
  accountMapping?: Record<string, string>;
}

export interface GroundImportOptions extends HistoryIndexOptions {
  minMatches?: number;
  categoryAgreement?: number;
}

// ── Orchestrator ─────────────────────────────────────────────────

export function groundImport(
  input: GroundImportInput,
  options: GroundImportOptions = {},
): GroundingOutcome {
  const { rows, history, accounts, categories } = input;
  const minMatches = options.minMatches ?? FAST_PATH_MIN_MATCHES;
  const categoryAgreement = options.categoryAgreement ?? FAST_PATH_CATEGORY_AGREEMENT;

  const activeCategories = categories.filter((c) => !c.archived);
  const activeAccounts = accounts.filter((a) => !a.archived);
  const validCategoryIds = new Set(activeCategories.map((c) => c.id));
  const validAccountIds = new Set(activeAccounts.map((a) => a.id));
  // Income-group category ids — used to keep deterministic assignments
  // type-correct: an expense row never inherits an income category (and vice
  // versa), even when its history is dominated by a miscategorized one.
  const incomeCategoryIds = new Set(
    activeCategories.filter((c) => c.group === "Income").map((c) => c.id),
  );

  // Account resolution: aliases first, then name matching, merged.
  const accountMapping = {
    ...matchAccountsByName(
      [...new Set(rows.map((r) => r.sourceAccount).filter(Boolean))],
      activeAccounts,
    ),
    ...(input.accountMapping ?? {}),
  };
  const resolveAccountId = (sourceAccount: string): string => {
    if (!sourceAccount) return "";
    const mapped = accountMapping[sourceAccount];
    return mapped && mapped !== "__create__" ? mapped : "";
  };

  const index = new HistoryIndex(history, options);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  // For transfer counterpart resolution: a historical transfer leg points at its
  // paired leg via transferPairId; the pair's accountId is the "other side".
  const historyById = new Map(history.map((t) => [t.id, t]));

  const results = new Map<string, GroundingResult>();
  const context = new Map<string, RowContext>();

  // First pass: history match + signal + fast-path (non-transfers) or
  // counterpart resolution (transfers).
  for (const row of rows) {
    const matches = index.match(buildMatchQuery(row.description));
    const accountId = resolveAccountId(row.sourceAccount);

    if (row.type === "transfer") {
      // Transfers skip merchant/category enrichment; grounding only resolves the
      // "From account" from matching historical transfer legs.
      results.set(row.id, {
        rowId: row.id,
        resolution: "ambiguous",
        merchant: "",
        categoryId: "",
        categoryConfidence: "",
        accountId,
        targetAccountId: resolveTransferCounterpart(matches, historyById, accountId, validAccountIds),
        duplicate: false,
      });
      continue;
    }

    const ctx = buildContext(matches, validCategoryIds);
    if (ctx.examples.length > 0) context.set(row.id, ctx);

    const fastPath = tryFastPath(matches, validCategoryIds, incomeCategoryIds, row.type, minMatches, categoryAgreement);

    if (fastPath) {
      results.set(row.id, {
        rowId: row.id,
        resolution: "fast-path",
        merchant: fastPath.merchant,
        categoryId: fastPath.categoryId,
        categoryConfidence: "high",
        accountId,
        targetAccountId: "",
        duplicate: false,
      });
      continue;
    }

    results.set(row.id, {
      rowId: row.id,
      resolution: "ambiguous",
      merchant: "",
      categoryId: "",
      categoryConfidence: "",
      accountId,
      targetAccountId: "",
      duplicate: false,
    });
  }

  // Second pass: dedup, now able to leverage the merchant resolved above.
  const dupMatches = detectDuplicates(
    rows,
    history,
    accountMapping,
    (imp) => results.get(imp.id)?.merchant ?? "",
  );
  for (const [rowId, dup] of dupMatches) {
    const existing = results.get(rowId);
    if (!existing) continue;
    const row = rowById.get(rowId);
    // Only carry the dup's category if it's type-correct for this row — a past
    // refund miscategorized as income must not pull an expense into income.
    const carryCategory =
      dup.matchedCategoryId &&
      row !== undefined &&
      categoryMatchesType(dup.matchedCategoryId, row.type, incomeCategoryIds);
    results.set(rowId, {
      ...existing,
      resolution: "duplicate",
      duplicate: true,
      duplicateMatch: dup,
      // Carry the original txn's merchant always; its category only when type-correct.
      merchant: dup.matchedMerchant || existing.merchant,
      categoryId: carryCategory ? dup.matchedCategoryId : existing.categoryId,
      categoryConfidence: carryCategory ? "high" : existing.categoryConfidence,
    });
  }

  return { results, context, stats: tallyStats(results) };
}

// ── Type guard ───────────────────────────────────────────────────

/** Whether a category is valid for a row's type: income rows take only
 *  Income-group categories; expense rows take only non-Income ones. (Transfers
 *  never reach the deterministic category assignments.) */
function categoryMatchesType(
  categoryId: string,
  rowType: ImportTransaction["type"],
  incomeCategoryIds: Set<string>,
): boolean {
  return incomeCategoryIds.has(categoryId) === (rowType === "income");
}

// ── Fast-path resolver ───────────────────────────────────────────

interface FastPathAssignment {
  merchant: string;
  categoryId: string;
}

function tryFastPath(
  matches: HistoryMatch[],
  validCategoryIds: Set<string>,
  incomeCategoryIds: Set<string>,
  rowType: ImportTransaction["type"],
  minMatches: number,
  categoryAgreement: number,
): FastPathAssignment | null {
  if (matches.length < minMatches) return null;

  // Only type-correct, valid categories are candidates — a history dominated by
  // a wrong-type category yields no winner here, so the row can't fast-path
  // into it (agreement below still votes the wrong-type matches against it).
  const counts = new Map<string, number>();
  for (const m of matches) {
    const id = m.txn.categoryId;
    if (!id || !validCategoryIds.has(id)) continue;
    if (!categoryMatchesType(id, rowType, incomeCategoryIds)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let topCategory = "";
  let topCount = 0;
  for (const [id, count] of counts) {
    if (count > topCount) {
      topCount = count;
      topCategory = id;
    }
  }

  // Agreement is over all matches — an uncategorized OR wrong-type historical
  // match is a vote against unanimity, so a thin or type-conflicted signal
  // can't fast-path.
  if (topCount / matches.length < categoryAgreement) return null;

  return { merchant: pickCanonicalMerchant(matches), categoryId: topCategory };
}

/** The canonical merchant: the most-recent merchant-source match's merchant,
 *  falling back to the most-frequent merchant text across matches. */
function pickCanonicalMerchant(matches: HistoryMatch[]): string {
  const merchantMatches = matches.filter((m) => m.source === "merchant" && m.txn.merchant.trim());
  if (merchantMatches.length > 0) {
    // matches are already score-then-recency ranked; take the freshest merchant.
    let best = merchantMatches[0];
    for (const m of merchantMatches) {
      if (m.txn.datetime.localeCompare(best.txn.datetime) > 0) best = m;
    }
    return best.txn.merchant.trim();
  }
  // No merchant-source match — fall back to most-frequent merchant text.
  const counts = countNames(matches.map((m) => m.txn.merchant));
  return counts[0]?.name ?? "";
}

// ── Transfer counterpart resolver ────────────────────────────────

/**
 * Suggest a transfer's "From account" from history. Among matching historical
 * transfer legs, each one's *paired* leg (via `transferPairId`) sits on the
 * counterpart account — that account is the suggestion. Picks the most-frequent
 * counterpart across matches, tie-broken by the most-recent supporting leg.
 *
 * Two are never suggested: the row's own resolved account (From ≠ the row's
 * account) and any account that isn't a current non-archived one (stale leg).
 * Returns "" when no usable counterpart is found.
 */
function resolveTransferCounterpart(
  matches: HistoryMatch[],
  historyById: Map<string, Transaction>,
  ownAccountId: string,
  validAccountIds: Set<string>,
): string {
  const counts = new Map<string, number>();
  const latest = new Map<string, string>();
  for (const m of matches) {
    if (m.txn.type !== "transfer" || !m.txn.transferPairId) continue;
    const pair = historyById.get(m.txn.transferPairId);
    if (!pair) continue;
    const counterpart = pair.accountId;
    if (!counterpart || counterpart === ownAccountId) continue;
    if (!validAccountIds.has(counterpart)) continue;
    counts.set(counterpart, (counts.get(counterpart) ?? 0) + 1);
    const prev = latest.get(counterpart);
    if (!prev || m.txn.datetime.localeCompare(prev) > 0) latest.set(counterpart, m.txn.datetime);
  }

  let best = "";
  let bestCount = 0;
  let bestDate = "";
  for (const [id, count] of counts) {
    const date = latest.get(id) ?? "";
    if (count > bestCount || (count === bestCount && date.localeCompare(bestDate) > 0)) {
      best = id;
      bestCount = count;
      bestDate = date;
    }
  }
  return best;
}

// ── Context sidecar ──────────────────────────────────────────────

function buildContext(
  matches: HistoryMatch[],
  validCategoryIds: Set<string>,
): RowContext {
  const examples: GroundingExample[] = topRecent(matches, CONTEXT_EXAMPLE_COUNT).map((m) => {
    const merchant = m.txn.merchant.trim();
    const note = m.txn.note.trim();
    const example: GroundingExample = { date: m.txn.datetime.slice(0, 10), amount: m.txn.amount };
    if (merchant) example.merchant = merchant;
    if (note) example.note = note;
    // A dead/archived category is dropped so the model never sees an
    // unresolvable id — the dominant signal stays a usable category.
    if (validCategoryIds.has(m.txn.categoryId)) example.categoryId = m.txn.categoryId;
    return example;
  });

  const merchantStats = countNames(matches.map((m) => m.txn.merchant));
  const categoryStats = countNames(
    matches.map((m) => m.txn.categoryId).filter((id) => validCategoryIds.has(id)),
  );

  return { examples, merchantStats, categoryStats };
}

/** Matches re-sorted most-recent-first for display (matches are unique per txn). */
function topRecent(matches: HistoryMatch[], count: number): HistoryMatch[] {
  return [...matches]
    .sort((a, b) => b.txn.datetime.localeCompare(a.txn.datetime))
    .slice(0, count);
}

/** Count distinct non-empty values, sorted by count desc then by name. */
function countNames(values: string[]): NameCount[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ── Stats ────────────────────────────────────────────────────────

function tallyStats(results: Map<string, GroundingResult>): GroundingStats {
  let duplicates = 0;
  let fastPathed = 0;
  let resolved = 0;
  let ambiguous = 0;
  for (const r of results.values()) {
    if (r.duplicate) duplicates++;
    if (r.resolution === "fast-path") fastPathed++;
    // "resolved" = won't need the classifier (dup, or has both merchant+category).
    if (r.duplicate || (r.merchant && r.categoryId)) resolved++;
    else if (r.resolution === "ambiguous") ambiguous++;
  }
  return { total: results.size, resolved, duplicates, fastPathed, ambiguous };
}
