import { useMemo, type ReactNode } from "react";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { useBudgetMeta } from "@/hooks/use-budget-meta";

/** Reads the budget's currency + format config from `budget.json` and provides
 *  it to the tree. Defaults (USD, standard formatting) come from `useBudgetMeta`
 *  before the file loads or for a budget missing the fields. */
export function CurrencyProvider({
  budgetPath,
  children,
}: {
  budgetPath: string;
  children: ReactNode;
}) {
  const { data } = useBudgetMeta(budgetPath);

  const config = useMemo<CurrencyConfig>(
    () => ({
      currency: data.currency,
      decimals: data.currencyDecimals,
      symbolPosition: data.currencySymbolPosition,
    }),
    [data.currency, data.currencyDecimals, data.currencySymbolPosition],
  );

  return <CurrencyContext.Provider value={config}>{children}</CurrencyContext.Provider>;
}
