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
  duplicate: boolean; // marked as already in the budget (dedup phase)
  duplicateOf: string; // matched existing transaction id (empty if not a duplicate)
  duplicateConfidence: string; // "high" | "low" | ""
}

/** Stored in .capy/aliases.json — survives across imports. */
export interface ImportAliases {
  accounts: Record<string, string>; // sourceString → accountId | "__create__"
}

/**
 * The import run's phase machine (see INTELLIGENCE.md § Import Sessions):
 *   idle → normalizing → accounts → dedup → enriching → review
 * Every phase is live. The dedup phase can short-circuit to `review` without
 * `enriching` when every staging row is a duplicate (the orchestrator's halt).
 */
export type ImportPhase =
  | "idle"
  | "normalizing"
  | "accounts"
  | "dedup"
  | "enriching"
  | "review";

/** Discrete progress-bar segments, in fill order. */
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

/** Phase → progress segment. `review` is terminal → `done`; `idle` has none. */
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
