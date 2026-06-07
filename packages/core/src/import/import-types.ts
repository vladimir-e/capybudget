/** Domain types for the Smart Import feature. */

/**
 * The shared intermediate contract both normalization paths produce. The CSV
 * mapper applies a `CsvMapping` to emit these; the image/PDF extractor reads
 * pixels and emits them directly. After this point no phase knows or cares how
 * a row was sourced. `buildStaged` is the single sink — it owns id assignment,
 * the trim-45 `description`, sign/type normalization, and defaults.
 *
 * `amount` is signed cents (negative = outflow, positive = inflow) — the source
 * adapter has already resolved the sign. `description` is the raw merchant text,
 * untrimmed; `buildStaged` is where the 45-char canonical form is cut.
 */
export interface StagedRecord {
  date: string;
  amount: number;
  type: "expense" | "income" | "transfer";
  description: string;
  sourceAccount: string;
  sourceCategory: string;
}

export interface ImportTransaction {
  id: string;
  date: string;
  description: string; // raw text trimmed to 45 chars — the canonical match + note form
  amount: number; // signed cents (negative = expense, positive = income)
  type: "expense" | "income" | "transfer";
  sourceAccount: string;
  sourceCategory: string;
  merchant: string; // cleaned merchant name
  accountId: string; // budget account UUID (resolved, may be empty)
  targetAccountId: string; // for transfers: the other account (empty = unmatched)
  categoryId: string; // budget category UUID (resolved, may be empty)
  categoryConfidence: string; // "high" | "low" | ""
  duplicate: boolean; // matches an existing budget txn — skip enrichment, unselect at merge
}

/** Stored in .capy/aliases.json — survives across imports. */
export interface ImportAliases {
  accounts: Record<string, string>; // sourceString → accountId | "__create__"
}

export type ImportPhase =
  | "upload"
  | "normalizing"
  | "preview"
  | "enriching"
  | "review";

/** One entry in the import log (`.capy/import-log.json`). */
export interface ImportLogEntry {
  date: string;
  sourceFiles: string[];
  transactionCount: number;
  accountsCreated: string[];
  dateRange: { from: string; to: string };
}
