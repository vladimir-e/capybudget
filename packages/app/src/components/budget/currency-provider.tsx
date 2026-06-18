import { type ReactNode } from "react";
import { CurrencyContext, DEFAULT_CURRENCY } from "@/contexts/currency-context";
import { useBudgetFile } from "@/hooks/use-budget-file";

/** Reads `BudgetMeta.currency` from `budget.json` and provides it to the tree.
 *  Falls back to USD before the file loads or when currency is absent. */
export function CurrencyProvider({
  budgetPath,
  children,
}: {
  budgetPath: string;
  children: ReactNode;
}) {
  const { data: currency } = useBudgetFile(
    budgetPath,
    "budget.json",
    DEFAULT_CURRENCY,
    (text) => (JSON.parse(text) as { currency?: string }).currency ?? DEFAULT_CURRENCY,
    (currency) => JSON.stringify({ currency }),
  );

  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}
