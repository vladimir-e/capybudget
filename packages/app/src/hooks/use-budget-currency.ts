/**
 * Reads `BudgetMeta.currency` from `budget.json`, shared by the
 * `CurrencyProvider` (formatting for the UI tree) and the `/budget` layout
 * (threading currency into the Capy session). Delegates to `useBudgetMeta`,
 * which owns parse/format for the shared `budget.json` cache key, so both
 * surfaces read one value and a currency change propagates everywhere at
 * once. Falls back to USD before the file loads or when the field is absent.
 */

import { useBudgetMeta } from "@/hooks/use-budget-meta";

export function useBudgetCurrency(budgetPath: string): string {
  return useBudgetMeta(budgetPath).data.currency;
}
