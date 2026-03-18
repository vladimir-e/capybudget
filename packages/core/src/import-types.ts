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
}

export type ImportPhase =
  | "upload"
  | "normalizing"
  | "preview"
  | "enriching"
  | "review";

export interface ImportSourceFile {
  name: string;
  size: number;
}

export interface ImportState {
  phase: ImportPhase;
  sourceFiles: ImportSourceFile[];
  startedAt?: string;
  normalizedAt?: string;
}
