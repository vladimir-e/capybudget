import { type ReactNode } from "react";
import { CurrencyContext } from "@/contexts/currency-context";
import { useBudgetCurrency } from "@/hooks/use-budget-currency";

/** Reads `BudgetMeta.currency` from `budget.json` and provides it to the tree.
 *  Falls back to USD before the file loads or when currency is absent. */
export function CurrencyProvider({
  budgetPath,
  children,
}: {
  budgetPath: string;
  children: ReactNode;
}) {
  const currency = useBudgetCurrency(budgetPath);

  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}
