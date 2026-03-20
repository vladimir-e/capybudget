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

export type ImportPhase =
  | "upload"
  | "normalizing"
  | "preview"
  | "enriching"
  | "review";
