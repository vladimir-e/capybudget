import {
  DEFAULT_CURRENCY,
  formatDefaultsFor,
  type BudgetMeta,
  type CurrencySettings,
} from "@capybudget/core";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { SCHEMA_VERSION } from "../../../../src/services/budget";
import { PROFILE_LIST } from "./profiles";
import type { DemoProfile } from "./profiles/types";

// Each scenario's budget.json must carry every currency its accounts hold, or
// `buildTodayRates` (which only iterates the budget's `currencies` map) values
// foreign holdings at 1.0. Foreign rows leave `rate` unset so the resolver
// falls back to the seed table — exactly as the real app does for an account
// added without a manual rate.
function metaFor(profile: DemoProfile): BudgetMeta {
  const codes = new Set([
    DEFAULT_CURRENCY,
    ...profile.accounts.map((a) => a.currency),
  ]);
  const currencies: Record<string, CurrencySettings> = {};
  for (const code of codes) currencies[code] = formatDefaultsFor(code);

  return {
    schemaVersion: SCHEMA_VERSION,
    name: profile.name,
    defaultCurrency: DEFAULT_CURRENCY,
    currencies,
    createdAt: "2020-01-01T00:00:00.000Z",
    lastModified: "2020-01-01T00:00:00.000Z",
  };
}

// Pre-seed every profile's budget.json into the in-memory fs stub at module
// load — before any React render fires `useBudgetFile`'s query — so the
// CurrencyProvider resolves the scenario's real currencies on first paint
// instead of the USD-only fallback. The fs stub writes its backing Map
// synchronously inside `writeTextFile`, so calling it (without awaiting the
// returned promise) lands the file before any query can read it. The path is
// built the same way `useBudgetFile` builds it (`join(budgetPath, fileName)`,
// which the demo stub implements as `"/"`-join) so the keys match exactly.
export function seedDemoBudgetMeta(): void {
  for (const profile of PROFILE_LIST) {
    void writeTextFile(
      `${profile.id}/budget.json`,
      JSON.stringify(metaFor(profile), null, 2),
    );
  }
}

seedDemoBudgetMeta();
