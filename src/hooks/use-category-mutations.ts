import { useMutation } from "@tanstack/react-query";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useMutationDeps } from "@/hooks/use-mutation-deps";
import type { Category, Transaction } from "@/lib/types";
import {
  type CategoryFormData,
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
} from "@/services/categories";

export function useCreateCategory() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
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

export function useReorderCategoryDnd() {
  const { queryClient, repo, captureSnapshot } = useMutationDeps();
  return useMutation({
    mutationFn: async (
      patches: Array<{ id: string; changes: Partial<Category> }>,
    ) => {
      captureSnapshot();
      const prev =
        queryClient.getQueryData<Category[]>(budgetKeys.categories()) ?? [];
      const patchMap = new Map(patches.map((p) => [p.id, p.changes]));
      const next = prev.map((c) => {
        const changes = patchMap.get(c.id);
        return changes ? { ...c, ...changes } : c;
      });
      queryClient.setQueryData(budgetKeys.categories(), next);
      await repo.saveCategories(next);
      return next;
    },
  });
}
