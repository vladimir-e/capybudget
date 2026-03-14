import { useBudgetMutation } from "@/hooks/use-budget-mutation";
import {
  bulkDeleteTransactions,
  bulkAssignCategory,
  bulkMoveAccount,
  bulkChangeDate,
  bulkChangeMerchant,
} from "@capybudget/core";

export function useBulkDeleteTransactions() {
  return useBudgetMutation<Set<string>>(async (ids, { transactions }) => {
    const next = bulkDeleteTransactions(ids, transactions.get());
    transactions.set(next);
    await transactions.save(next);
  });
}

export function useBulkAssignCategory() {
  return useBudgetMutation<{ ids: Set<string>; categoryId: string }>(
    async ({ ids, categoryId }, { transactions }) => {
      const next = bulkAssignCategory(ids, categoryId, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}

export function useBulkMoveAccount() {
  return useBudgetMutation<{ ids: Set<string>; accountId: string }>(
    async ({ ids, accountId }, { transactions }) => {
      const next = bulkMoveAccount(ids, accountId, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}

export function useBulkChangeDate() {
  return useBudgetMutation<{ ids: Set<string>; date: string }>(
    async ({ ids, date }, { transactions }) => {
      const next = bulkChangeDate(ids, date, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}

export function useBulkChangeMerchant() {
  return useBudgetMutation<{ ids: Set<string>; merchant: string }>(
    async ({ ids, merchant }, { transactions }) => {
      const next = bulkChangeMerchant(ids, merchant, transactions.get());
      transactions.set(next);
      await transactions.save(next);
    },
  );
}
