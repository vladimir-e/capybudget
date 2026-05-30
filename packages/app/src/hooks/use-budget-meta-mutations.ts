import type { BudgetBasis } from "@capybudget/core";
import { useBudgetMutation } from "@/hooks/use-budget-mutation";

/** Set the budget-level comparison basis, preserving all other budget.json
 *  fields. No-op if the meta query hasn't loaded yet. */
export function useSetBudgetBasis() {
  return useBudgetMutation<BudgetBasis>(
    async (basis, { meta }) => {
      const current = meta.get();
      if (!current) return;
      const next = { ...current, basis };
      meta.set(next);
      await meta.save(next);
    },
    { snapshot: false },
  );
}
