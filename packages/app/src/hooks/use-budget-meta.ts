import { useCallback } from "react";
import {
  DEFAULT_CURRENCY,
  formatDefaultsFor,
  resolveBudgetCurrency,
  type BudgetCurrencyFields,
  type BudgetMeta,
  type CurrencySettings,
  type MoneyFormat,
} from "@capybudget/core";
import { useBudgetFile } from "@/hooks/use-budget-file";
import { SCHEMA_VERSION } from "../../../../src/services/budget";

const DEFAULT_META: BudgetMeta = {
  schemaVersion: SCHEMA_VERSION,
  name: "",
  defaultCurrency: DEFAULT_CURRENCY,
  currencies: { [DEFAULT_CURRENCY]: formatDefaultsFor(DEFAULT_CURRENCY) },
  createdAt: "",
  lastModified: "",
};

function parseMeta(text: string): BudgetMeta {
  const stored = JSON.parse(text) as BudgetCurrencyFields & Partial<BudgetMeta>;
  // Pick the entity identity explicitly and resolve the currency settings —
  // any superseded flat currency fields are left behind, never re-saved.
  return {
    schemaVersion: stored.schemaVersion ?? DEFAULT_META.schemaVersion,
    name: stored.name ?? DEFAULT_META.name,
    createdAt: stored.createdAt ?? DEFAULT_META.createdAt,
    lastModified: stored.lastModified ?? DEFAULT_META.lastModified,
    ...resolveBudgetCurrency(stored),
  };
}

interface UseBudgetMetaReturn {
  data: BudgetMeta;
  isLoading: boolean;
  setName: (name: string) => Promise<void>;
  setCurrency: (currency: string) => Promise<void>;
  setBudgetFormat: (format: MoneyFormat) => Promise<void>;
  /** Seed a foreign currency's entry from its curated defaults if it isn't in
   *  the map yet; a no-op once it exists. Drives persist-when-empty — a used
   *  currency gets an entry that survives even after the last account on it is
   *  deleted. */
  ensureCurrency: (currency: string) => Promise<void>;
  /** Merge a partial update into a foreign currency's entry (rate + provenance
   *  or display knobs). Backfills display defaults if the entry is absent. */
  setCurrencyEntry: (currency: string, update: Partial<CurrencySettings>) => Promise<void>;
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
    (currency: string) =>
      // Switching the default currency re-seeds its display from the new
      // currency's defaults, discarding any manual tweaks the user had on the
      // prior default.
      save((prev) => ({
        ...prev,
        defaultCurrency: currency,
        currencies: { ...prev.currencies, [currency]: formatDefaultsFor(currency) },
        lastModified: new Date().toISOString(),
      })),
    [save],
  );

  const setBudgetFormat = useCallback(
    (format: MoneyFormat) =>
      save((prev) => ({
        ...prev,
        currencies: {
          ...prev.currencies,
          [prev.defaultCurrency]: { ...prev.currencies[prev.defaultCurrency], ...format },
        },
        lastModified: new Date().toISOString(),
      })),
    [save],
  );

  const ensureCurrency = useCallback(
    (currency: string) =>
      save((prev) =>
        prev.currencies[currency]
          ? prev
          : {
              ...prev,
              currencies: { ...prev.currencies, [currency]: formatDefaultsFor(currency) },
              lastModified: new Date().toISOString(),
            },
      ),
    [save],
  );

  const setCurrencyEntry = useCallback(
    (currency: string, update: Partial<CurrencySettings>) =>
      save((prev) => ({
        ...prev,
        currencies: {
          ...prev.currencies,
          [currency]: {
            ...formatDefaultsFor(currency),
            ...prev.currencies[currency],
            ...update,
          },
        },
        lastModified: new Date().toISOString(),
      })),
    [save],
  );

  return {
    data,
    isLoading,
    setName,
    setCurrency,
    setBudgetFormat,
    ensureCurrency,
    setCurrencyEntry,
    save,
  };
}
