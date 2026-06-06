import type { ImportTransaction, Transaction } from "@capybudget/core";
import { formatMoney } from "@capybudget/core";

/**
 * The preview's view of a duplicate row, derived entirely from the persisted
 * staging flags the agent wrote (`duplicate`/`duplicateOf`/`duplicateConfidence`)
 * — never from a live recompute. `matched` resolves the original from
 * `duplicateOf` against the budget, when it's still present, for richer display.
 */
export interface DuplicateInfo {
  confidence: string; // "high" | "low" | ""
  duplicateOf: string;
  matched: Transaction | null;
}

/**
 * Build the duplicate view keyed by staging-row id from the persisted flags.
 * The agent is the single source of truth: a row is a duplicate iff its
 * `duplicate` flag is set. `duplicateOf` is resolved against the budget for the
 * matched-original affordance.
 */
export function buildDuplicateView(
  transactions: ImportTransaction[],
  existingTransactions: Transaction[],
): Map<string, DuplicateInfo> {
  const view = new Map<string, DuplicateInfo>();
  if (transactions.length === 0) return view;

  const byId = new Map(existingTransactions.map((t) => [t.id, t]));
  for (const txn of transactions) {
    if (!txn.duplicate) continue;
    view.set(txn.id, {
      confidence: txn.duplicateConfidence,
      duplicateOf: txn.duplicateOf,
      matched: txn.duplicateOf ? byId.get(txn.duplicateOf) ?? null : null,
    });
  }
  return view;
}

/** Compose the merge-ready completion summary line from the run's counts
 *  ("47 ready, 3 duplicates dimmed."). ready = selected non-duplicate rows;
 *  duplicates = rows the dedup phase marked. */
export function readySummary(counts: { ready: number; duplicates: number }): string {
  const { ready, duplicates } = counts;
  const rows = `${ready} ready`;
  return duplicates > 0
    ? `${rows}, ${duplicates} duplicate${duplicates === 1 ? "" : "s"} dimmed.`
    : `${rows}.`;
}

export type ImportSortColumn =
  | "date"
  | "merchant"
  | "amount"
  | "type"
  | "sourceAccount"
  | "categoryId";

export interface ImportSortConfig {
  column: ImportSortColumn;
  direction: "asc" | "desc";
}

export function amountColorClass(txn: ImportTransaction): string {
  if (txn.type === "income") return "text-amount-income";
  if (txn.type === "expense") return "text-amount-expense";
  return "text-muted-foreground";
}

export function sortImportTransactions(
  transactions: ImportTransaction[],
  sort: ImportSortConfig,
): ImportTransaction[] {
  const sorted = [...transactions];
  const dir = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "date":
        cmp = a.date.localeCompare(b.date);
        break;
      case "merchant":
        cmp = (a.merchant || a.description).localeCompare(b.merchant || b.description);
        break;
      case "amount":
        cmp = a.amount - b.amount;
        break;
      case "type":
        cmp = a.type.localeCompare(b.type);
        break;
      case "sourceAccount":
        cmp = a.sourceAccount.localeCompare(b.sourceAccount);
        break;
      case "categoryId":
        cmp = a.categoryId.localeCompare(b.categoryId);
        break;
    }
    return cmp * dir;
  });

  return sorted;
}

export function filterImportTransactions(
  transactions: ImportTransaction[],
  search: string,
): ImportTransaction[] {
  if (!search) return transactions;
  const q = search.toLowerCase();
  return transactions.filter(
    (t) =>
      t.description.toLowerCase().includes(q) ||
      (t.merchant && t.merchant.toLowerCase().includes(q)) ||
      t.sourceAccount.toLowerCase().includes(q) ||
      t.sourceCategory.toLowerCase().includes(q) ||
      t.memo.toLowerCase().includes(q) ||
      t.type.includes(q) ||
      formatMoney(t.amount).toLowerCase().includes(q),
  );
}
