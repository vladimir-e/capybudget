/**
 * Reads and writes the full `BudgetMeta` from `budget.json`, the single owner
 * of parse/format for the `budget.json` cache key. `CurrencyProvider` and the
 * `/budget` layout read currency and format through this, and every updater
 * does a read-modify-write so a single-field change never clobbers
 * name/schemaVersion/timestamps. Backed by `useBudgetFile`, so a write
 * re-renders every consumer (UI tree + Capy session) at once.
 */

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

/** Parse `budget.json` into a full `BudgetMeta`, filling any missing field
 *  from the defaults. Currency and the two format fields predate each other,
 *  so a pre-format budget.json backfills decimals + symbol position from the
 *  currency's curated defaults — the same values the in-app schema migration
 *  would have written. */
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
  /** Read-modify-write: persists `name` and refreshes `lastModified`.
   *  Renames the budget's display name in `budget.json`, not the folder. */
  setName: (name: string) => Promise<void>;
  /** Read-modify-write: persists `currency` and re-seeds the format knobs
   *  (decimals + symbol position) from the new currency's defaults, so a switch
   *  lands on the conventional formatting instead of carrying the prior
   *  currency's tweaks. Manual tweaks afterward go through `setBudgetFormat`. */
  setCurrency: (currency: string) => Promise<void>;
  /** Read-modify-write: persists a format override (decimals + symbol
   *  position) without touching the currency. */
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
    (name: string) => save({ ...data, name, lastModified: new Date().toISOString() }),
    [data, save],
  );

  const setCurrency = useCallback(
    (currency: string) => {
      const format = formatDefaultsFor(currency);
      return save({
        ...data,
        currency,
        currencyDecimals: format.decimals,
        currencySymbolPosition: format.symbolPosition,
        lastModified: new Date().toISOString(),
      });
    },
    [data, save],
  );

  const setBudgetFormat = useCallback(
    (format: MoneyFormat) =>
      save({
        ...data,
        currencyDecimals: format.decimals,
        currencySymbolPosition: format.symbolPosition,
        lastModified: new Date().toISOString(),
      }),
    [data, save],
  );

  return { data, isLoading, setName, setCurrency, setBudgetFormat, save };
}
