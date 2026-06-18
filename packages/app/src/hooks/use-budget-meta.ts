/**
 * Reads and writes the full `BudgetMeta` from `budget.json`, the single owner
 * of parse/format for the `budget.json` cache key. `useBudgetCurrency` and
 * `CurrencyProvider` read currency through this, and `setCurrency` does a
 * read-modify-write so a currency change never clobbers name/schemaVersion/
 * timestamps. Backed by `useBudgetFile`, so a write re-renders every consumer
 * (UI tree + Capy session) at once.
 */

import { useCallback } from "react";
import { DEFAULT_CURRENCY, type BudgetMeta } from "@capybudget/core";
import { useBudgetFile } from "@/hooks/use-budget-file";
import { SCHEMA_VERSION } from "../../../../src/services/budget";

const DEFAULT_META: BudgetMeta = {
  schemaVersion: SCHEMA_VERSION,
  name: "",
  currency: DEFAULT_CURRENCY,
  createdAt: "",
  lastModified: "",
};

/** Parse `budget.json` into a full `BudgetMeta`, filling any missing field
 *  from the defaults so a pre-currency budget.json doesn't crash. */
function parseMeta(text: string): BudgetMeta {
  const raw = JSON.parse(text) as Partial<BudgetMeta>;
  return { ...DEFAULT_META, ...raw, currency: raw.currency ?? DEFAULT_CURRENCY };
}

interface UseBudgetMetaReturn {
  data: BudgetMeta;
  isLoading: boolean;
  /** Read-modify-write: persists `currency` and refreshes `lastModified`,
   *  preserving every other meta field. */
  setCurrency: (currency: string) => Promise<void>;
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

  const setCurrency = useCallback(
    (currency: string) =>
      save({ ...data, currency, lastModified: new Date().toISOString() }),
    [data, save],
  );

  return { data, isLoading, setCurrency, save };
}
