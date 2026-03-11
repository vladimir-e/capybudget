import type { Category, Transaction } from "@/lib/types";

export interface CategoryFormData {
  id?: string;
  name: string;
  group: string;
}

export function createCategory(
  input: CategoryFormData,
  existing: Category[],
): Category[] {
  const groupCategories = existing.filter((c) => c.group === input.group);
  const maxSortOrder = groupCategories.reduce(
    (max, c) => Math.max(max, c.sortOrder),
    0,
  );

  const newCategory: Category = {
    id: crypto.randomUUID(),
    name: input.name,
    group: input.group as Category["group"],
    archived: false,
    sortOrder: maxSortOrder + 1,
  };

  return [...existing, newCategory];
}

export function updateCategory(
  input: CategoryFormData,
  existing: Category[],
): Category[] {
  return existing.map((c) =>
    c.id === input.id
      ? { ...c, name: input.name, group: input.group as Category["group"] }
      : c,
  );
}

export function deleteCategory(
  categoryId: string,
  categories: Category[],
  transactions: Transaction[],
): { categories: Category[]; transactions: Transaction[] } {
  return {
    categories: categories.filter((c) => c.id !== categoryId),
    transactions: transactions.map((t) =>
      t.categoryId === categoryId ? { ...t, categoryId: "" } : t,
    ),
  };
}

export function archiveCategory(
  categoryId: string,
  existing: Category[],
): Category[] {
  return existing.map((c) =>
    c.id === categoryId ? { ...c, archived: true } : c,
  );
}

export function unarchiveCategory(
  categoryId: string,
  existing: Category[],
): Category[] {
  return existing.map((c) =>
    c.id === categoryId ? { ...c, archived: false } : c,
  );
}

export function reorderCategories(
  group: string,
  orderedIds: string[],
  existing: Category[],
): Category[] {
  const orderMap = new Map(orderedIds.map((id, i) => [id, i + 1]));

  return existing.map((c) =>
    c.group === group && orderMap.has(c.id)
      ? { ...c, sortOrder: orderMap.get(c.id)! }
      : c,
  );
}

export function moveCategory(
  categoryId: string,
  targetGroup: string,
  targetIndex: number,
  existing: Category[],
): Category[] {
  const category = existing.find((c) => c.id === categoryId);
  if (!category) return existing;

  // Drag to "Archived" → archive, keep original group
  if (targetGroup === "Archived") {
    return existing.map((c) =>
      c.id === categoryId ? { ...c, archived: true } : c,
    );
  }

  // Get target group categories (excluding the moved one)
  const targetCats = existing
    .filter(
      (c) => c.group === targetGroup && !c.archived && c.id !== categoryId,
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const index = Math.max(0, Math.min(targetIndex, targetCats.length));
  const orderedIds = targetCats.map((c) => c.id);
  orderedIds.splice(index, 0, categoryId);

  const orderMap = new Map(orderedIds.map((id, i) => [id, i + 1]));

  return existing.map((c) => {
    if (c.id === categoryId) {
      return {
        ...c,
        group: targetGroup as Category["group"],
        archived: false,
        sortOrder: orderMap.get(c.id)!,
      };
    }
    if (orderMap.has(c.id)) {
      return { ...c, sortOrder: orderMap.get(c.id)! };
    }
    return c;
  });
}
