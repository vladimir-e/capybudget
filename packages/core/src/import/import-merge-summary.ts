import type { Account, Transaction } from "../entities/types";
import { prepareMerge, type MergeInput } from "./import-merge";
import type { ImportAliases } from "./import-types";

export interface MergeSummary {
  /** Selected transfers that the merge couldn't pair (no counterpart matched),
   *  so they import as income/expense. A wrong-but-not-corrupting outcome worth
   *  flagging, not enumerating. */
  unmappedTransferCount: number;
}

/**
 * Summarize what a merge will do, for the confirmation gate. Derived from the
 * real merge plan so the preview can never diverge from what merge does — the
 * downgrade count comes straight off `prepareMerge`, immune to how it emits
 * transfer legs.
 */
export function summarizeMerge(
  input: MergeInput,
  prevAccounts: Account[],
  prevTransactions: Transaction[],
  defaultCurrency: string,
  existingAliases: ImportAliases = { accounts: {} },
): MergeSummary {
  if (input.selectedIds.size === 0) return { unmappedTransferCount: 0 };
  const result = prepareMerge(
    input,
    prevAccounts,
    prevTransactions,
    defaultCurrency,
    existingAliases,
  );
  return { unmappedTransferCount: result.downgradedTransferCount };
}
