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
  categoryId: string; // budget category UUID (AI guess, may be empty)
  categoryConfidence: string; // "high" | "low" | ""
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
