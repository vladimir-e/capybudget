/**
 * Pure transaction aggregation — the single grouping engine behind the chat
 * `group_transactions` tool. Takes an *already-filtered* array (the handler
 * owns filtering) and rolls it up by one or more dimensions, computing the
 * requested metrics per group.
 *
 * All money is **signed** integer cents: spending groups sum *negative*.
 * That's correct and deliberate — the model is told amounts are signed and
 * reads the sign.
 *
 * Dates are taken from the `YYYY-MM-DD` prefix of `datetime` (the local
 * calendar date the app writes), never re-parsed through a timezone. Cadence
 * day-gaps parse that prefix at local noon, mirroring `parseLocalDate`.
 */

import type { Account, Category, Transaction } from "../entities/types";
import { IDENTITY_CONVERTER, type CurrencyConverter } from "./converter";

export type GroupDimension =
  | "merchant"
  | "category"
  | "account"
  | "type"
  | "month"
  | "week"
  | "dayOfMonth"
  | "amountBucket";

export type GroupMetric =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "median"
  | "distinctMerchants"
  | "distinctAccounts"
  | "distinctCategories"
  | "distinctAmounts"
  | "cadence";

export interface GroupCadence {
  /** Number of transactions in the group (occurrences). */
  occurrences: number;
  /** Median consecutive day-gap; null when fewer than 2 occurrences. */
  medianGapDays: number | null;
  /** Smallest consecutive day-gap; null when fewer than 2 occurrences. */
  minGapDays: number | null;
  /** Largest consecutive day-gap; null when fewer than 2 occurrences. */
  maxGapDays: number | null;
  /** Median absolute deviation of the gaps; null when fewer than 2 occurrences. */
  madGapDays: number | null;
}

/**
 * One aggregated group. `key` carries the dimension values in `groupBy`
 * order — each a resolved, model-readable label (and the raw id where it
 * matters, see {@link GroupKeyPart}). The metric fields are present only
 * when requested.
 */
export interface TransactionGroup {
  key: GroupKeyPart[];
  count?: number;
  sum?: number;
  avg?: number;
  min?: number;
  max?: number;
  median?: number;
  distinctMerchants?: number;
  distinctAccounts?: number;
  distinctCategories?: number;
  distinctAmounts?: number;
  cadence?: GroupCadence;
}

/**
 * A single dimension value in a group's key. `dimension` and `label` are
 * always present; `id` carries the raw entity id for merchant/category/account
 * dimensions so the model can drill back in (`label` is the human name —
 * "Groceries" — and `id` the UUID).
 */
export interface GroupKeyPart {
  dimension: GroupDimension;
  label: string;
  id?: string;
}

export interface GroupContext {
  accounts: Account[];
  categories: Category[];
  /** Values each transaction's amount in the default currency at its stamped
   *  flow rate before any metric or bucketing. Defaults to identity. */
  converter?: CurrencyConverter;
}

export interface GroupOptions {
  groupBy: GroupDimension[];
  metrics: GroupMetric[];
  /** Bucket size in cents for the `amountBucket` dimension. Defaults to exact
   *  amount (group by the precise signed cents — the duplicate-detection case). */
  amountBucketCents?: number;
  /** Sort groups by this metric. Requires the metric to be requested. */
  sortByMetric?: Exclude<GroupMetric, "cadence">;
  /** Sort direction. Defaults to descending. */
  sortDir?: "asc" | "desc";
  /** Keep only the top-N groups after sorting. */
  limit?: number;
}

// ── Statistics over signed cents ────────────────────────────────────────

/** Min via reduce (no spread) — correct at any array size, unlike
 *  `Math.min(...arr)` which overflows the call stack on huge arrays. */
function minOf(values: number[]): number {
  return values.reduce((a, b) => (b < a ? b : a), values[0]);
}

/** Max via reduce — see {@link minOf}. */
function maxOf(values: number[]): number {
  return values.reduce((a, b) => (b > a ? b : a), values[0]);
}

/** Median of a numeric array. Even counts average the two middles. Empty → 0. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── Date helpers (string-prefix based, timezone-stable) ─────────────────

/** `YYYY-MM` calendar-month key from a transaction datetime. */
function monthKey(datetime: string): string {
  return datetime.slice(0, 7);
}

/** Day-of-month (1–31) from a transaction datetime. */
function dayOfMonthKey(datetime: string): string {
  return String(Number(datetime.slice(8, 10)));
}

/** Parse the `YYYY-MM-DD` prefix at local noon (mirrors core `parseLocalDate`). */
function parseDatePrefix(datetime: string): Date {
  return new Date(datetime.slice(0, 10) + "T12:00:00");
}

/**
 * ISO-8601 week key (`YYYY-Www`) from a transaction's date prefix. Weeks
 * start Monday; the week-year can differ from the calendar year near a
 * year boundary (the spec's `YYYY-Www`).
 */
function weekKey(datetime: string): string {
  const d = parseDatePrefix(datetime);
  // ISO week: shift to the Thursday of this week, then count weeks from Jan 1.
  const target = new Date(d.getTime());
  const dayNum = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  target.setDate(target.getDate() - dayNum + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${target.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Whole-day count since the epoch for a datetime's date prefix. */
function dayNumber(datetime: string): number {
  return Math.round(parseDatePrefix(datetime).getTime() / 86400000);
}

// ── Cadence (recurrence substrate) ──────────────────────────────────────

/**
 * Cadence over a group's occurrences: sort the dates, take consecutive
 * day-gaps, return median / min / max gap + MAD + occurrence count. A single
 * occurrence yields count 1 and null gaps (no interval to measure).
 */
export function computeCadence(txns: Transaction[]): GroupCadence {
  const occurrences = txns.length;
  if (occurrences < 2) {
    return {
      occurrences,
      medianGapDays: null,
      minGapDays: null,
      maxGapDays: null,
      madGapDays: null,
    };
  }
  const days = txns.map((t) => dayNumber(t.datetime)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);

  const med = median(gaps);
  const deviations = gaps.map((g) => Math.abs(g - med));
  return {
    occurrences,
    medianGapDays: med,
    minGapDays: minOf(gaps),
    maxGapDays: maxOf(gaps),
    madGapDays: median(deviations),
  };
}

// ── Dimension key extraction ────────────────────────────────────────────

interface NameMaps {
  accounts: Map<string, string>;
  categories: Map<string, string>;
}

function buildNameMaps(ctx: GroupContext): NameMaps {
  return {
    accounts: new Map(ctx.accounts.map((a) => [a.id, a.name])),
    categories: new Map(ctx.categories.map((c) => [c.id, c.name])),
  };
}

/** Bucket signed cents into a labeled range. `size <= 0` → group by exact amount. */
function amountBucketPart(amount: number, size: number): GroupKeyPart {
  if (size <= 0) {
    return { dimension: "amountBucket", label: String(amount) };
  }
  // Floor toward negative infinity so -150 with size 100 lands in [-200,-100).
  const low = Math.floor(amount / size) * size;
  const high = low + size;
  return { dimension: "amountBucket", label: `${low}..${high}` };
}

function keyPart(
  dimension: GroupDimension,
  txn: Transaction,
  amount: number,
  maps: NameMaps,
  amountBucketCents: number,
): GroupKeyPart {
  switch (dimension) {
    case "merchant":
      return { dimension, label: txn.merchant || "(none)" };
    case "category":
      return {
        dimension,
        label: maps.categories.get(txn.categoryId) ?? (txn.categoryId || "Uncategorized"),
        id: txn.categoryId,
      };
    case "account":
      return {
        dimension,
        label: maps.accounts.get(txn.accountId) ?? txn.accountId,
        id: txn.accountId,
      };
    case "type":
      return { dimension, label: txn.type };
    case "month":
      return { dimension, label: monthKey(txn.datetime) };
    case "week":
      return { dimension, label: weekKey(txn.datetime) };
    case "dayOfMonth":
      return { dimension, label: dayOfMonthKey(txn.datetime) };
    case "amountBucket":
      return amountBucketPart(amount, amountBucketCents);
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────

/** Composite-key separator. A NUL byte can't appear in a merchant label, so
 *  it never collides multi-key combos the way a printable separator could. */
const KEY_SEP = String.fromCharCode(0);

interface Bucket {
  key: GroupKeyPart[];
  txns: Transaction[];
  /** Default-currency amounts, parallel to `txns`, valued at each
   *  transaction's stamped flow rate. Drives every amount-based metric. */
  amounts: number[];
}

function computeMetrics(
  bucket: Bucket,
  metrics: GroupMetric[],
): TransactionGroup {
  const txns = bucket.txns;
  const amounts = bucket.amounts;
  const group: TransactionGroup = { key: bucket.key };

  for (const metric of metrics) {
    switch (metric) {
      case "count":
        group.count = txns.length;
        break;
      case "sum":
        group.sum = amounts.reduce((a, b) => a + b, 0);
        break;
      case "avg":
        // A bucket exists only because a transaction landed in it, so
        // `amounts.length` is always ≥ 1 here.
        group.avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        break;
      case "min":
        group.min = minOf(amounts);
        break;
      case "max":
        group.max = maxOf(amounts);
        break;
      case "median":
        group.median = median(amounts);
        break;
      case "distinctMerchants":
        group.distinctMerchants = new Set(txns.map((t) => t.merchant)).size;
        break;
      case "distinctAccounts":
        group.distinctAccounts = new Set(txns.map((t) => t.accountId)).size;
        break;
      case "distinctCategories":
        group.distinctCategories = new Set(txns.map((t) => t.categoryId)).size;
        break;
      case "distinctAmounts":
        group.distinctAmounts = new Set(amounts).size;
        break;
      case "cadence":
        group.cadence = computeCadence(txns);
        break;
    }
  }
  return group;
}

/**
 * Sort value for the chosen metric. Coerces anything non-numeric to 0 so an
 * unrequested metric — or `cadence`, whose value is an object the model can
 * still pass as a free-string `sortByMetric` despite the type — sorts as a
 * stable no-op instead of producing `NaN` comparisons.
 */
function sortValue(group: TransactionGroup, metric: Exclude<GroupMetric, "cadence">): number {
  const v = group[metric];
  return typeof v === "number" ? v : 0;
}

/**
 * Group an already-filtered transaction array by one or more dimensions and
 * compute the requested metrics per group. Returns groups sorted by
 * `sortByMetric` (when given) and capped to `limit`. Empty input → `[]`.
 */
export function groupTransactions(
  transactions: Transaction[],
  opts: GroupOptions,
  ctx: GroupContext,
): TransactionGroup[] {
  const maps = buildNameMaps(ctx);
  const converter = ctx.converter ?? IDENTITY_CONVERTER;
  const bucketSize = opts.amountBucketCents ?? 0;

  // Composite key id: prefer each part's entity id (so two accounts sharing a
  // display name stay separate), fall back to the label, joined with a NUL
  // separator so a free-form merchant name can't collide multi-key combos.
  const buckets = new Map<string, Bucket>();
  for (const txn of transactions) {
    const amount = converter.flowToDefault(txn.amount, txn.fxRate);
    const key = opts.groupBy.map((dim) => keyPart(dim, txn, amount, maps, bucketSize));
    const id = key.map((p) => p.id ?? p.label).join(KEY_SEP);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { key, txns: [], amounts: [] };
      buckets.set(id, bucket);
    }
    bucket.txns.push(txn);
    bucket.amounts.push(amount);
  }

  let groups = [...buckets.values()].map((b) => computeMetrics(b, opts.metrics));

  if (opts.sortByMetric) {
    const metric = opts.sortByMetric;
    const dir = opts.sortDir === "asc" ? 1 : -1;
    groups = [...groups].sort(
      (a, b) => (sortValue(a, metric) - sortValue(b, metric)) * dir,
    );
  }

  if (typeof opts.limit === "number" && opts.limit >= 0) {
    groups = groups.slice(0, opts.limit);
  }

  return groups;
}
