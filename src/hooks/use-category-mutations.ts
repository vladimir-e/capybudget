import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/repositories";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import type { Category, Transaction } from "@/lib/types";
import {
  type CategoryFormData,
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
  reorderCategories,
} from "@/services/categories";

export function useCreateCategory() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (data: CategoryFormData) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const next = createCategory(data, prev);
      queryClient.setQueryData(budgetKeys.categories(), next);
      await repo.saveCategories(next);
      return next;
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (data: CategoryFormData) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const next = updateCategory(data, prev);
      queryClient.setQueryData(budgetKeys.categories(), next);
      await repo.saveCategories(next);
      return next;
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      captureSnapshot();
      const prevCategories =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const prevTransactions =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ??
        [];
      const { categories, transactions } = deleteCategory(
        categoryId,
        prevCategories,
        prevTransactions,
      );
      queryClient.setQueryData(budgetKeys.categories(), categories);
      queryClient.setQueryData(budgetKeys.transactions(), transactions);
      await repo.saveCategories(categories);
      await repo.saveTransactions(transactions);
      return { categories, transactions };
    },
  });
}

export function useArchiveCategory() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const next = archiveCategory(categoryId, prev);
      queryClient.setQueryData(budgetKeys.categories(), next);
      await repo.saveCategories(next);
      return next;
    },
  });
}

export function useUnarchiveCategory() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (categoryId: string) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const next = unarchiveCategory(categoryId, prev);
      queryClient.setQueryData(budgetKeys.categories(), next);
      await repo.saveCategories(next);
      return next;
    },
  });
}

export function useReorderCategories() {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  return useMutation({
    mutationFn: async (data: { group: string; orderedIds: string[] }) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const next = reorderCategories(data.group, data.orderedIds, prev);
      queryClient.setQueryData(budgetKeys.categories(), next);
      await repo.saveCategories(next);
      return next;
    },
  });
}
