import { getAccountBalance } from "../analytics/queries";
import type { Account, AccountType, Transaction } from "../entities/types";
import { prepareMerge, resolveAccountId, type MergeInput } from "./import-merge";
import type { ImportAliases } from "./import-types";

/** One import source account's stake in a pending merge: where it maps, how many
 *  of its rows land, and the destination's true post-merge balance. Derived from
 *  the real merge plan so the preview can never diverge from what merge does. */
export interface MergeAccountSummary {
  sourceAccount: string;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  isNew: boolean;
  count: number;
  resultingBalance: number;
}

export interface MergeSummary {
  /** One row per import source account — the account-mapping axis, the same set
   *  the Map-accounts dialog edits. Transfer-counterpart accounts are not rows. */
  rows: MergeAccountSummary[];
  /** Selected transfers that the merge couldn't pair (no counterpart matched),
   *  so they import as income/expense. A wrong-but-not-corrupting outcome worth
   *  flagging, not enumerating. */
  unmappedTransferCount: number;
}

/**
 * Summarize what a merge will do, per import source account.
 *
 * Rows follow the account-mapping axis (one per source account), not the set of
 * destination accounts: a transfer leg landing on a counterpart account is not a
 * mapping the user made and isn't listed. The destination balance still reflects
 * those legs because it's read from the full merge plan via `getAccountBalance`.
 */
export function summarizeMerge(
  input: MergeInput,
  prevAccounts: Account[],
  prevTransactions: Transaction[],
  existingAliases: ImportAliases = { accounts: {} },
): MergeSummary {
  const selected = input.transactions.filter((t) => input.selectedIds.has(t.id));
  if (selected.length === 0) return { rows: [], unmappedTransferCount: 0 };

  const result = prepareMerge(input, prevAccounts, prevTransactions, existingAliases);
  const newAccountIds = new Set(Object.values(result.createdAccountIds));
  const accountById = new Map(result.accounts.map((a) => [a.id, a]));

  // Distinct source accounts, in stable encounter-name order.
  const sourceAccounts = [
    ...new Set(selected.map((t) => t.sourceAccount).filter(Boolean)),
  ];

  const countBySource = new Map<string, number>();
  for (const t of selected) {
    if (!t.sourceAccount) continue;
    countBySource.set(t.sourceAccount, (countBySource.get(t.sourceAccount) ?? 0) + 1);
  }

  const rows: MergeAccountSummary[] = [];
  for (const sourceAccount of sourceAccounts) {
    const sample = selected.find((t) => t.sourceAccount === sourceAccount)!;
    const accountId = resolveAccountId(sample, result.createdAccountIds, input.accountMapping);
    const account = accountById.get(accountId);
    if (!account) continue;
    rows.push({
      sourceAccount,
      accountId,
      accountName: account.name,
      accountType: account.type,
      isNew: newAccountIds.has(accountId),
      count: countBySource.get(sourceAccount) ?? 0,
      // True post-merge balance over the full plan — includes any transfer leg
      // that lands here, even though such a leg never produces its own row.
      resultingBalance: getAccountBalance(accountId, result.transactions),
    });
  }

  rows.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.accountName.localeCompare(b.accountName);
  });

  // The downgrade count comes straight off the plan, so it stays correct no
  // matter how prepareMerge emits transfer legs.
  return { rows, unmappedTransferCount: result.downgradedTransferCount };
}
