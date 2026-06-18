/**
 * Reads `BudgetMeta.currency` from `budget.json`, shared by the
 * `CurrencyProvider` (formatting for the UI tree) and the `/budget` layout
 * (threading currency into the Capy session). Backed by the same
 * `useBudgetFile` cache key, so both surfaces read one value and a currency
 * change propagates everywhere at once. Falls back to USD before the file
 * loads or when the field is absent.
 */

import { useBudgetFile } from "@/hooks/use-budget-file";
import { DEFAULT_CURRENCY } from "@/contexts/currency-context";

export function useBudgetCurrency(budgetPath: string): string {
  const { data } = useBudgetFile(
    budgetPath,
    "budget.json",
    DEFAULT_CURRENCY,
    (text) => (JSON.parse(text) as { currency?: string }).currency ?? DEFAULT_CURRENCY,
    (currency) => JSON.stringify({ currency }),
  );
  return data;
}
