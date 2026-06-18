import { useCallback } from "react";
import {
  DEFAULT_CURRENCY,
  formatDefaultsFor,
  resolveBudgetFormat,
  type BudgetMeta,
  type MoneyFormat,
} from "@capybudget/core";
import { useBudgetFile } from "@/hooks/use-budget-file";
import { SCHEMA_VERSION } from "../../../../src/services/budget";

const DEFAULT_FORMAT = formatDefaultsFor(DEFAULT_CURRENCY);

const DEFAULT_META: BudgetMeta = {
  schemaVersion: SCHEMA_VERSION,
  name: "",
  currency: DEFAULT_CURRENCY,
  currencyDecimals: DEFAULT_FORMAT.decimals,
  currencySymbolPosition: DEFAULT_FORMAT.symbolPosition,
  createdAt: "",
  lastModified: "",
};

function parseMeta(text: string): BudgetMeta {
  const raw = JSON.parse(text) as Partial<BudgetMeta>;
  const { currency, decimals, symbolPosition } = resolveBudgetFormat(raw);
  return {
    ...DEFAULT_META,
    ...raw,
    currency,
    currencyDecimals: decimals,
    currencySymbolPosition: symbolPosition,
  };
}

interface UseBudgetMetaReturn {
  data: BudgetMeta;
  isLoading: boolean;
  setName: (name: string) => Promise<void>;
  setCurrency: (currency: string) => Promise<void>;
  setBudgetFormat: (format: MoneyFormat) => Promise<void>;
  save: (meta: BudgetMeta) => Promise<void>;
}

export function useBudgetMeta(budgetPath: string): UseBudgetMetaReturn {
  const { data, isLoading, save } = useBudgetFile<BudgetMeta>(
    budgetPath,
    "budget.json",
    DEFAULT_META,
    parseMeta,
    (meta) => JSON.stringify(meta, null, 2),
  );

  const setName = useCallback(
    (name: string) =>
      save((prev) => ({ ...prev, name, lastModified: new Date().toISOString() })),
    [save],
  );

  const setCurrency = useCallback(
    (currency: string) => {
      // Switching currency re-seeds format from the new currency's defaults,
      // discarding any manual tweaks the user had on the prior currency.
      const format = formatDefaultsFor(currency);
      return save((prev) => ({
        ...prev,
        currency,
        currencyDecimals: format.decimals,
        currencySymbolPosition: format.symbolPosition,
        lastModified: new Date().toISOString(),
      }));
    },
    [save],
  );

  const setBudgetFormat = useCallback(
    (format: MoneyFormat) =>
      save((prev) => ({
        ...prev,
        currencyDecimals: format.decimals,
        currencySymbolPosition: format.symbolPosition,
        lastModified: new Date().toISOString(),
      })),
    [save],
  );

  return { data, isLoading, setName, setCurrency, setBudgetFormat, save };
}
