import type { Account, BudgetMeta, Transaction } from "../entities/types";
import {
  formatDefaultsFor,
  type CurrencySettings,
} from "./money";
import { resolveRate, SEED_RATES, type SeedRateTable } from "./rates";

/** The three files a default-currency switch can touch, returned together so the
 *  caller persists them atomically. Accounts and transactions are returned even
 *  when untouched (case A leaves transactions as-is) so the caller has one shape. */
export interface RebaseResult {
  meta: BudgetMeta;
  accounts: Account[];
  transactions: Transaction[];
}

// A stamp this close to 1.0 is a default-currency flow — a NEW-currency account's
// old stamp `rate(NEW→OLD)` collapses to exactly `1/k`, so `oldStamp × k` lands on
// 1.0 to float precision. Clearing it (undefined) makes those flows default, the
// byte-identical state a fresh NEW budget would have. The window is tight enough
// that no genuinely foreign post-rebase rate is mistaken for the default.
const DEFAULT_RATE_EPSILON = 1e-9;

function isDefaultRate(rate: number): boolean {
  return Math.abs(rate - 1) < DEFAULT_RATE_EPSILON;
}

/**
 * Rebase a budget's default currency from its current value to `newCurrency`,
 * value-preservingly. Money is never re-written: native amounts stay put and
 * only the *unit of account* — `defaultCurrency`, every stored fxRate, and the
 * rate map — moves. Two cases, distinguished by whether any account holds a
 * non-default currency:
 *
 * **A — single-currency (no foreign account).** A plain relabel: the new default,
 * every account re-labeled to it, the map reset to just the new currency's
 * display defaults. Transactions are already stamp-free (default-currency), so
 * they pass through untouched. Amounts keep their exact numbers; 1000 stays 1000.
 *
 * **B — multi-currency (≥1 foreign account).** A value-preserving rebase by one
 * constant `k = rate(OLD→NEW) = 1 / resolveRate(NEW→OLD)`:
 *   - Every transaction's stored fxRate ⇒ `(oldStamp ?? 1) × k`. An OLD-default
 *     transaction (no stamp = 1.0) becomes `k`; a NEW-currency transaction's
 *     stamp collapses to 1.0 and is cleared (now default). Native amounts untouched.
 *   - The rate map is re-expressed against NEW: NEW becomes the default entry
 *     (its display knobs preserved if it had a foreign row, its rate dropped),
 *     OLD gains a rate of `k`, and each surviving foreign currency's manual rate
 *     is carried as `rate × k`. Seed-sourced entries store no rate and re-resolve
 *     against NEW from the seed table.
 *   - Accounts keep their native currencies.
 *
 * The invariant in both cases: `round(amount × newStamp) ≈ round(amount × oldStamp)
 * × k` per transaction, and holding value scales uniformly by `k` — so every chart
 * keeps its shape, restated in the new unit (case A is `k = 1`).
 */
export function rebaseDefaultCurrency(
  meta: BudgetMeta,
  accounts: Account[],
  transactions: Transaction[],
  newCurrency: string,
  table: SeedRateTable = SEED_RATES,
): RebaseResult {
  const oldCurrency = meta.defaultCurrency;
  if (newCurrency === oldCurrency) {
    return { meta, accounts, transactions };
  }

  const isMultiCurrency = accounts.some((a) => a.currency !== oldCurrency);
  const now = new Date().toISOString();

  if (!isMultiCurrency) {
    return {
      meta: {
        ...meta,
        defaultCurrency: newCurrency,
        currencies: { [newCurrency]: formatDefaultsFor(newCurrency) },
        lastModified: now,
      },
      accounts: accounts.map((a) => ({ ...a, currency: newCurrency })),
      transactions,
    };
  }

  // k = rate(OLD→NEW): the value of 1 OLD unit in NEW. Derived as the reciprocal
  // of NEW→OLD so a manual rate the user set on NEW carries its intent across.
  const newToOld = resolveRate(newCurrency, meta.currencies, oldCurrency, table);
  const k = 1 / newToOld.rate;

  return {
    meta: {
      ...meta,
      defaultCurrency: newCurrency,
      currencies: rebaseCurrencyMap(meta.currencies, oldCurrency, newCurrency, k, newToOld.source),
      lastModified: now,
    },
    accounts,
    transactions: transactions.map((txn) => rebaseTransaction(txn, k)),
  };
}

function rebaseTransaction(txn: Transaction, k: number): Transaction {
  const newRate = (txn.fxRate ?? 1) * k;
  if (isDefaultRate(newRate)) {
    if (txn.fxRate === undefined) return txn;
    const cleared = { ...txn };
    delete cleared.fxRate;
    return cleared;
  }
  return { ...txn, fxRate: newRate };
}

/**
 * Re-express the currency map against `newCurrency`. NEW becomes the default
 * entry (display knobs preserved from any prior foreign row, rate dropped). Every
 * other entry's rate moves into the NEW unit by `× k`, but only when it was a
 * manual override — a seed-sourced entry stores no rate and re-resolves against
 * the new default from the seed table, the same as before the switch. OLD, which
 * had no entry as the prior default, gains one carrying `k` with NEW's provenance.
 */
function rebaseCurrencyMap(
  currencies: Record<string, CurrencySettings>,
  oldCurrency: string,
  newCurrency: string,
  k: number,
  oldEntryProvenance: "manual" | "seed" | "unset",
): Record<string, CurrencySettings> {
  const newDefaultKnobs = currencies[newCurrency] ?? formatDefaultsFor(newCurrency);
  const result: Record<string, CurrencySettings> = {
    [newCurrency]: {
      decimals: newDefaultKnobs.decimals,
      symbolPosition: newDefaultKnobs.symbolPosition,
    },
  };

  for (const [code, entry] of Object.entries(currencies)) {
    if (code === newCurrency) continue;
    if (code === oldCurrency) continue; // re-added below with the right rate
    const carried: CurrencySettings = {
      decimals: entry.decimals,
      symbolPosition: entry.symbolPosition,
    };
    if (entry.rateSource === "manual" && entry.rate !== undefined) {
      carried.rate = entry.rate * k;
      carried.rateSource = "manual";
    }
    result[code] = carried;
  }

  // OLD becomes a foreign currency valued at k against NEW. A manual provenance
  // (the user had set NEW's rate by hand) pins k so it survives a seed refresh;
  // a seed/unset provenance stores no rate and lets the table re-derive OLD→NEW.
  const oldKnobs = currencies[oldCurrency] ?? formatDefaultsFor(oldCurrency);
  const oldEntry: CurrencySettings = {
    decimals: oldKnobs.decimals,
    symbolPosition: oldKnobs.symbolPosition,
  };
  if (oldEntryProvenance === "manual") {
    oldEntry.rate = k;
    oldEntry.rateSource = "manual";
  }
  result[oldCurrency] = oldEntry;

  return result;
}
