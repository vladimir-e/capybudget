import type { Account, AccountType, Category } from "@capybudget/core";
import { DEFAULT_CATEGORIES } from "@capybudget/core";

/** The demo's category set — the app's default taxonomy with stable ids. Shared
 *  by every profile so generated transactions reference the same categories the
 *  real app ships with. */
export function createCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((c, i) => ({ ...c, id: `cat-${i}` }));
}

/** Compact account builder. `createdAt` is fixed and irrelevant to analytics
 *  (which key off transaction datetimes), so a constant keeps profiles terse. */
export function account(
  id: string,
  name: string,
  type: AccountType,
  sortOrder: number,
): Account {
  return {
    id,
    name,
    type,
    archived: false,
    excludeFromNetWorth: false,
    sortOrder,
    createdAt: "2020-01-01T00:00:00Z",
  };
}
