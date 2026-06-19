import { getAccountBalance } from "../analytics/queries";
import type { Account, AccountType, Transaction } from "../entities/types";
import { prepareMerge, resolveAccountId, type MergeInput } from "./import-merge";
import type { ImportAliases } from "./import-types";

/** One account's stake in a pending merge — what lands where, and the balance
 *  it produces. Derived from the real merge plan so the preview can never
 *  diverge from what merge actually does. */
export interface MergeAccountSummary {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  isNew: boolean;
  /** Import source name(s) feeding this account. Empty for a transfer-target
   *  account that isn't itself an import source. */
  sourceAccounts: string[];
  count: number;
  /** Sum of the landing transactions' amounts (signed cents). */
  delta: number;
  currentBalance: number;
  resultingBalance: number;
}

/**
 * Summarize what a merge will do, per destination account.
 *
 * Groups by the *resulting* `accountId` rather than by import source: a transfer
 * leg lands on its counterpart account even though no import source names it, and
 * a mis-pointed transfer corrupts the budget just as a mis-mapped source does, so
 * the target must surface here too.
 */
export function summarizeMerge(
  input: MergeInput,
  prevAccounts: Account[],
  prevTransactions: Transaction[],
  existingAliases: ImportAliases = { accounts: {} },
): MergeAccountSummary[] {
  const result = prepareMerge(input, prevAccounts, prevTransactions, existingAliases);

  // prepareMerge appends new transactions after the previous ones, so the tail
  // beyond the original length is exactly what this merge adds.
  const newTxns = result.transactions.slice(prevTransactions.length);

  const newAccountIds = new Set(Object.values(result.createdAccountIds));
  const accountById = new Map(result.accounts.map((a) => [a.id, a]));

  const sourcesByAccount = new Map<string, Set<string>>();
  const selected = input.transactions.filter((t) => input.selectedIds.has(t.id));
  for (const t of selected) {
    if (!t.sourceAccount) continue;
    const accountId = resolveAccountId(t, result.createdAccountIds, input.accountMapping);
    if (!accountId) continue;
    const set = sourcesByAccount.get(accountId) ?? new Set<string>();
    set.add(t.sourceAccount);
    sourcesByAccount.set(accountId, set);
  }

  const byAccount = new Map<string, { count: number; delta: number }>();
  for (const t of newTxns) {
    if (!t.accountId) continue;
    const agg = byAccount.get(t.accountId) ?? { count: 0, delta: 0 };
    agg.count += 1;
    agg.delta += t.amount;
    byAccount.set(t.accountId, agg);
  }

  const summaries: MergeAccountSummary[] = [];
  for (const [accountId, { count, delta }] of byAccount) {
    const account = accountById.get(accountId);
    if (!account) continue;
    const isNew = newAccountIds.has(accountId);
    const currentBalance = isNew ? 0 : getAccountBalance(accountId, prevTransactions);
    summaries.push({
      accountId,
      accountName: account.name,
      accountType: account.type,
      isNew,
      sourceAccounts: [...(sourcesByAccount.get(accountId) ?? [])].sort(),
      count,
      delta,
      currentBalance,
      resultingBalance: currentBalance + delta,
    });
  }

  summaries.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.accountName.localeCompare(b.accountName);
  });

  return summaries;
}
