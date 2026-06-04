/**
 * Pure transaction text/money matching — the single source of truth for the
 * fuzzy search the app's toolbar, the drilldown browser, and the chat
 * `search_transactions` tool all run.
 *
 * Takes plain data (accounts/categories for name resolution); no app types,
 * no React, no repository. App-side date-range handling stays in the app's
 * `filterTransactions`; only the cross-field substring + money predicate
 * lives here.
 */

import type { Account, Category, Transaction } from "../entities/types";
import { formatMoney } from "../utils/money";

/**
 * Whether a lowercase query matches a money amount. Matches against the
 * formatted form ("$1,850.00"), its comma-stripped form ("$1850.00"), and
 * the currency-stripped form ("1850.00") — so "1850", "1,850", "$1850",
 * "-12", and partials like "29" → "$1.29" / "$290.00" all hit.
 *
 * `query` is assumed already lowercased (it has no letters, so this only
 * matters for the caller's consistency).
 */
export function matchesMoney(cents: number, query: string): boolean {
  const formatted = formatMoney(cents).toLowerCase();
  if (formatted.includes(query)) return true;
  const plain = formatted.replace(/,/g, "");
  if (plain.includes(query)) return true;
  const noCurrency = plain.replace("$", "");
  return noCurrency.includes(query);
}

/**
 * Lowercased name lookups, built once and reused across rows. Empty/unknown
 * `categoryId` resolves to "uncategorized" so typing that word matches
 * uncategorized rows (mirrors how the transaction list labels them).
 */
interface NameMaps {
  accounts: Map<string, string>;
  categories: Map<string, string>;
}

function buildNameMaps(accounts: Account[], categories: Category[]): NameMaps {
  return {
    accounts: new Map(accounts.map((a) => [a.id, a.name.toLowerCase()])),
    categories: new Map(categories.map((c) => [c.id, c.name.toLowerCase()])),
  };
}

function categoryText(categoryId: string, categories: Map<string, string>): string {
  return categories.get(categoryId) ?? "uncategorized";
}

function matchesRow(txn: Transaction, query: string, maps: NameMaps): boolean {
  if (txn.merchant.toLowerCase().includes(query)) return true;
  if (txn.note.toLowerCase().includes(query)) return true;
  if (categoryText(txn.categoryId, maps.categories).includes(query)) return true;
  if (maps.accounts.get(txn.accountId)?.includes(query)) return true;
  return matchesMoney(txn.amount, query);
}

export interface SearchContext {
  accounts: Account[];
  categories: Category[];
}

/**
 * Whether a transaction matches a free-text query across merchant, note,
 * category name, account name, and money formats. Case-insensitive; the
 * query is trimmed internally. An empty/whitespace query matches everything.
 */
export function matchesTransaction(
  txn: Transaction,
  query: string,
  ctx: SearchContext,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return matchesRow(txn, q, buildNameMaps(ctx.accounts, ctx.categories));
}

/**
 * Filter transactions to those matching a free-text query. Name maps are
 * built once for the whole pass. An empty/whitespace query returns the input
 * unchanged.
 */
export function searchTransactions(
  transactions: Transaction[],
  query: string,
  ctx: SearchContext,
): Transaction[] {
  const q = query.trim().toLowerCase();
  if (!q) return transactions;
  const maps = buildNameMaps(ctx.accounts, ctx.categories);
  return transactions.filter((t) => matchesRow(t, q, maps));
}
