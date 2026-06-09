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

/** One recent transfer leg surfaced to the model, by counterpart account name. */
export interface TransferLeg {
  account: string;
  amount: number;
}

/** A counterpart account with how often it appeared, by name. */
export interface AccountCount {
  account: string;
  count: number;
}

/**
 * Per-transfer-row context — the imported account's own direction-aware
 * transfer history, so the model can pick this row's counterpart. The
 * counterpart is a property of the *accounts*, not the row's words: the
 * description (e.g. "ACH BOFA SAV 123") only disambiguates which of the
 * account's transfer partners this leg belongs to. Everything is by account
 * NAME — the model never sees an id. Parallel to {@link RowContext} but for
 * transfers; the orchestrator persists it to `transfer-context.json`.
 */
export interface TransferContext {
  /** Matching-direction legs from the last 2 months, chronological, capped at
   *  10 — so a periodic transfer's cadence is visible. */
  recentTransfers: TransferLeg[];
  /** Top-3 counterpart accounts by transfer count in this direction. */
  topAccounts: AccountCount[];
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
  /** True when the row duplicates an existing budget transaction. */
  duplicate: boolean;
  /** The match's tier when `duplicate` — `low` is a relaxed ±day-window match
   *  the preview flags as a possible duplicate. Else "". */
  duplicateConfidence: "high" | "low" | "";
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
  /** Transfer-context sidecar, keyed by row id — only transfer rows with
   *  matching-direction history have an entry. */
  transferContext: Map<string, TransferContext>;
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
  // Transfer context keys off the imported account's own transfer legs, by
  // direction — built once per account from history, indexed for fast reuse.
  const transferIndex = new TransferHistoryIndex(history, activeAccounts);

  const results = new Map<string, GroundingResult>();
  const context = new Map<string, RowContext>();
  const transferContext = new Map<string, TransferContext>();

  // First pass: history match + signal + fast-path (non-transfers) or the
  // direction-aware transfer-context sidecar (transfers — the model decides the
  // counterpart during Categorizing).
  for (const row of rows) {
    const accountId = resolveAccountId(row.sourceAccount);

    if (row.type === "transfer") {
      // Transfers skip merchant/category enrichment; grounding only attaches the
      // account's own direction-matching transfer history so the model can pick
      // the counterpart. No targetAccountId is set here — that's the model's job.
      const ctx = transferIndex.contextFor(accountId, row.amount);
      if (ctx) transferContext.set(row.id, ctx);
      results.set(row.id, {
        rowId: row.id,
        resolution: "ambiguous",
        merchant: "",
        categoryId: "",
        categoryConfidence: "",
        accountId,
        duplicate: false,
        duplicateConfidence: "",
      });
      continue;
    }

    const matches = index.match(buildMatchQuery(row.description));
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
        duplicate: false,
        duplicateConfidence: "",
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
      duplicate: false,
      duplicateConfidence: "",
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
      duplicateConfidence: dup.confidence,
      duplicateMatch: dup,
      // Carry the original txn's merchant always; its category only when type-correct.
      merchant: dup.matchedMerchant || existing.merchant,
      categoryId: carryCategory ? dup.matchedCategoryId : existing.categoryId,
      categoryConfidence: carryCategory ? "high" : existing.categoryConfidence,
    });
  }

  return { results, context, transferContext, stats: tallyStats(results) };
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

// ── Transfer context ─────────────────────────────────────────────

/** How far back `recentTransfers` reaches, anchored to the account's most-recent
 *  matching-direction leg (not wall-clock) so the window holds whether the
 *  import runs the day after the last transfer or a year later. */
const RECENT_TRANSFER_WINDOW_MONTHS = 2;
/** Cap on `recentTransfers` legs — a periodic transfer's cadence shows within a
 *  handful; more is noise in the prompt. */
const RECENT_TRANSFER_CAP = 10;
/** How many counterpart accounts `topAccounts` ranks. */
const TOP_ACCOUNT_COUNT = 3;

/** One counterpart-resolved historical transfer leg on the imported account. */
interface CounterpartLeg {
  datetime: string;
  /** The leg's own signed amount (sign = direction on the imported account). */
  amount: number;
  /** The paired account's current name. */
  counterpart: string;
}

/**
 * The imported account's own transfer history, grouped by account and direction.
 *
 * A transfer leg's counterpart is a property of the *accounts* — the row's
 * description only disambiguates which partner this leg belongs to. So for a
 * transfer row we hand the model the imported account's matching-direction legs
 * (inflow row → the account's *incoming* legs, outflow → its *outgoing* legs),
 * each resolved to its counterpart account NAME via `transferPairId`. A leg
 * whose counterpart is archived/gone, is the account itself, or has no current
 * name is dropped (the model can't pick an id it won't see in the dropdown).
 *
 * Built once per run; `contextFor` is O(legs) per row.
 */
class TransferHistoryIndex {
  /** accountId → that account's counterpart-resolved transfer legs. */
  private readonly byAccount = new Map<string, CounterpartLeg[]>();

  constructor(history: Transaction[], activeAccounts: Account[]) {
    const nameById = new Map(activeAccounts.map((a) => [a.id, a.name]));
    const byId = new Map(history.map((t) => [t.id, t]));
    for (const txn of history) {
      if (txn.type !== "transfer" || !txn.transferPairId) continue;
      const pair = byId.get(txn.transferPairId);
      if (!pair) continue;
      const counterpart = nameById.get(pair.accountId);
      // Drop a counterpart that's archived/gone or is the account itself.
      if (!counterpart || pair.accountId === txn.accountId) continue;
      const legs = this.byAccount.get(txn.accountId);
      const leg: CounterpartLeg = { datetime: txn.datetime, amount: txn.amount, counterpart };
      if (legs) legs.push(leg);
      else this.byAccount.set(txn.accountId, [leg]);
    }
  }

  /**
   * The transfer context for an imported account + a row's amount, or null when
   * the account has no matching-direction transfer history (the model leaves the
   * counterpart blank). Direction is by the row's sign: inflow (> 0) needs a
   * "from" account → the account's incoming legs; outflow (< 0) needs a "to"
   * account → its outgoing legs. A zero-amount row has no direction → null.
   */
  contextFor(accountId: string, rowAmount: number): TransferContext | null {
    if (!accountId || rowAmount === 0) return null;
    const all = this.byAccount.get(accountId);
    if (!all) return null;
    const wantInflow = rowAmount > 0;
    const matching = all.filter((leg) => leg.amount > 0 === wantInflow);
    if (matching.length === 0) return null;

    return {
      recentTransfers: recentLegs(matching),
      topAccounts: topCounterparts(matching),
    };
  }
}

/** The matching-direction legs from the last {@link RECENT_TRANSFER_WINDOW_MONTHS}
 *  months (anchored to the most-recent leg), chronological, capped. The window
 *  is computed on the date portion only — months, not hours — so it's free of
 *  the timezone skew that mixing `Z` and local ISO datetimes in a lexical
 *  compare would introduce. */
function recentLegs(matching: CounterpartLeg[]): TransferLeg[] {
  const sorted = [...matching].sort((a, b) => a.datetime.localeCompare(b.datetime));
  const newestDate = sorted[sorted.length - 1].datetime.slice(0, 10);
  const cutoff = monthsBefore(newestDate, RECENT_TRANSFER_WINDOW_MONTHS);
  return sorted
    .filter((leg) => leg.datetime.slice(0, 10) >= cutoff)
    .slice(-RECENT_TRANSFER_CAP)
    .map((leg) => ({ account: leg.counterpart, amount: leg.amount }));
}

/** The top-{@link TOP_ACCOUNT_COUNT} counterpart accounts by leg count, count
 *  desc then name asc for a stable order. */
function topCounterparts(matching: CounterpartLeg[]): AccountCount[] {
  const counts = new Map<string, number>();
  for (const leg of matching) counts.set(leg.counterpart, (counts.get(leg.counterpart) ?? 0) + 1);
  return [...counts.entries()]
    .map(([account, count]) => ({ account, count }))
    .sort((a, b) => b.count - a.count || a.account.localeCompare(b.account))
    .slice(0, TOP_ACCOUNT_COUNT);
}

/** A `YYYY-MM-DD` date `months` before `date` (also `YYYY-MM-DD`), clamping the
 *  day so it stays a real date (e.g. Mar 31 − 1mo → Feb 28/29). Pure calendar
 *  arithmetic on the parts — no `Date`, no timezone. */
function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = (y * 12 + (m - 1)) - months;
  const ty = Math.floor(target / 12);
  const tm = target % 12; // 0-indexed month
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
