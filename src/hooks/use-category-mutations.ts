import type { Category, CategoryFormData } from "@capybudget/core";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
} from "@capybudget/core";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";

export function useCreateCategory() {
  return useBudgetMutation<CategoryFormData>(async (data, { categories }) => {
    const next = createCategory(data, categories.get());
    categories.set(next);
    await categories.save(next);
  });
}

export function useUpdateCategory() {
  return useBudgetMutation<CategoryFormData>(async (data, { categories }) => {
    const next = updateCategory(data, categories.get());
    categories.set(next);
    await categories.save(next);
  });
}

export function useDeleteCategory() {
  return useBudgetMutation<string>(async (categoryId, { categories, transactions }) => {
    const result = deleteCategory(categoryId, categories.get(), transactions.get());
    categories.set(result.categories);
    transactions.set(result.transactions);
    await categories.save(result.categories);
    await transactions.save(result.transactions);
  });
}

export function useArchiveCategory() {
  return useBudgetMutation<string>(async (categoryId, { categories }) => {
    const next = archiveCategory(categoryId, categories.get());
    categories.set(next);
    await categories.save(next);
  });
}

export function useUnarchiveCategory() {
  return useBudgetMutation<string>(async (categoryId, { categories }) => {
    const next = unarchiveCategory(categoryId, categories.get());
    categories.set(next);
    await categories.save(next);
  });
}

export function useReorderCategoryDnd() {
  return useBudgetMutation<Array<{ id: string; changes: Partial<Category> }>>(
    async (patches, { categories }) => {
      const prev = categories.get();
      const patchMap = new Map(patches.map((p) => [p.id, p.changes]));
      const next = prev.map((c) => {
        const changes = patchMap.get(c.id);
        return changes ? { ...c, ...changes } : c;
      });
      categories.set(next);
      await categories.save(next);
    },
  );
}
