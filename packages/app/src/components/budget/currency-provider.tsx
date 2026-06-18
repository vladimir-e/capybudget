import { useMemo, type ReactNode } from "react";
import { CurrencyContext, type CurrencyConfig } from "@/contexts/currency-context";
import { useBudgetMeta } from "@/hooks/use-budget-meta";

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
