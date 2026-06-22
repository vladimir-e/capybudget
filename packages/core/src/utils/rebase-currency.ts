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
 *   - A transaction whose account holds `newCurrency` is now a home-currency
 *     flow: its fxRate is cleared (face value), whatever it was stamped at —
 *     dollars have no rate against themselves, so a $1000 deposit must read
 *     $1000 and reconcile with its account's balance.
 *   - Every other transaction's stored fxRate ⇒ `(oldStamp ?? 1) × k`. An
 *     OLD-default transaction (no stamp = 1.0) becomes `k`. Native amounts untouched.
 *   - The rate map is re-expressed against NEW: NEW becomes the default entry
 *     (its display knobs preserved if it had a foreign row, its rate dropped),
 *     OLD gains a rate of `k`, and each surviving foreign currency's manual rate
 *     is carried as `rate × k`. Seed-sourced entries store no rate and re-resolve
 *     against NEW from the seed table.
 *   - Accounts keep their native currencies.
 *
 * The invariant: a non-home transaction's default value scales by `k`
 * (`round(amount × newStamp) ≈ round(amount × oldStamp) × k`); a home transaction
 * snaps to its native face amount. Holdings value at 1.0 = face for the new
 * default. Case A is the degenerate `k = 1`.
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

  const accountCurrency = new Map(accounts.map((a) => [a.id, a.currency]));

  return {
    meta: {
      ...meta,
      defaultCurrency: newCurrency,
      currencies: rebaseCurrencyMap(meta.currencies, oldCurrency, newCurrency, k, newToOld.source),
      lastModified: now,
    },
    accounts,
    transactions: transactions.map((txn) =>
      rebaseTransaction(txn, k, accountCurrency.get(txn.accountId) === newCurrency),
    ),
  };
}

// A home-currency flow (its account holds the new default) takes face value: its
// fxRate is cleared, whatever it was stamped at. Otherwise the stamp rescales by
// k into the new unit. A transfer's two legs are separate transactions, so the
// home leg clears while the foreign leg rescales — each by its own account.
function rebaseTransaction(txn: Transaction, k: number, isHome: boolean): Transaction {
  if (isHome) {
    if (txn.fxRate === undefined) return txn;
    const cleared = { ...txn };
    delete cleared.fxRate;
    return cleared;
  }
  return { ...txn, fxRate: (txn.fxRate ?? 1) * k };
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
