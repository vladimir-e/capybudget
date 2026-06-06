/** Domain types for the Smart Import feature. */

export interface ImportTransaction {
  id: string;
  date: string;
  description: string;
  amount: number; // signed cents (negative = expense, positive = income)
  type: "expense" | "income" | "transfer";
  sourceAccount: string;
  sourceCategory: string;
  memo: string;
  merchant: string; // cleaned merchant name
  accountId: string; // budget account UUID (AI guess, may be empty)
  targetAccountId: string; // for transfers: the other account (empty = unmatched)
  categoryId: string; // budget category UUID (AI guess, may be empty)
  categoryConfidence: string; // "high" | "low" | ""
}

/** Stored in .capy/aliases.json — survives across imports. */
export interface ImportAliases {
  accounts: Record<string, string>; // sourceString → accountId | "__create__"
}

/**
 * The import run's phase machine. The agentic run advances through the
 * working phases in order, then lands on the terminal merge-ready review.
 *
 *   idle → normalizing → accounts → dedup → enriching → review
 *
 * `idle` is the pre-run state (drop zone / file list). `accounts` and
 * `dedup` are wired by later units (account mapping, duplicate review);
 * the pipeline runs through them as inert pass-throughs until then.
 * `review` is the preview/table — work is done, the user merges.
 *
 * Naming preserves `normalizing` / `enriching` / `review` from the
 * original three-state store so existing call sites keep working.
 */
export type ImportPhase =
  | "idle"
  | "normalizing"
  | "accounts"
  | "dedup"
  | "enriching"
  | "review";

/**
 * Discrete progress-bar segments, in fill order. Unit 5 drives the bar
 * off the phase machine via {@link IMPORT_PHASE_SEGMENT}; the `accounts`
 * and `dedup` segments stay inert until their units land.
 */
export type ImportSegment =
  | "normalize"
  | "accounts"
  | "dedup"
  | "enrich"
  | "done";

export const IMPORT_SEGMENTS: readonly ImportSegment[] = [
  "normalize",
  "accounts",
  "dedup",
  "enrich",
  "done",
];

/**
 * Phase → progress segment. `review` is the merge-ready terminal state,
 * so it maps to `done` (the bar is full). `idle` has no segment.
 */
export const IMPORT_PHASE_SEGMENT: Record<
  Exclude<ImportPhase, "idle">,
  ImportSegment
> = {
  normalizing: "normalize",
  accounts: "accounts",
  dedup: "dedup",
  enriching: "enrich",
  review: "done",
};

/** One entry in the import log (`.capy/import-log.json`). */
export interface ImportLogEntry {
  date: string;
  sourceFiles: string[];
  transactionCount: number;
  accountsCreated: string[];
  dateRange: { from: string; to: string };
}
