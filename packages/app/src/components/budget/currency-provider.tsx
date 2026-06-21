import { useMemo, type ReactNode } from "react";
import { defaultCurrencySettings } from "@capybudget/core";
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
  const { decimals, symbolPosition } = defaultCurrencySettings(data);

  const config = useMemo<CurrencyConfig>(
    () => ({ currency: data.defaultCurrency, decimals, symbolPosition }),
    [data.defaultCurrency, decimals, symbolPosition],
  );

  return <CurrencyContext.Provider value={config}>{children}</CurrencyContext.Provider>;
}
