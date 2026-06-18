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

// Grouped two-decimal amount without any currency symbol — search matches on
// the number, never the symbol, so the predicate is currency-independent.
const amountFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Whether a query matches a money amount. Currency-agnostic: it compares the
 * digits, not the display string. The amount renders symbol-free as a grouped
 * two-decimal number ("1,850.00", "-12.50"), and the query is stripped to its
 * numeric characters — so "1850", "1,850", "-12", a stray "$1850", and partials
 * like "29" → "1.29" / "290.00" all hit, regardless of the budget's currency.
 */
export function matchesMoney(cents: number, query: string): boolean {
  const q = query.replace(/[^0-9.,-]/g, "");
  if (!/[0-9]/.test(q)) return false;
  const sign = cents < 0 ? "-" : "";
  const grouped = sign + amountFormat.format(Math.abs(cents) / 100);
  if (grouped.includes(q)) return true;
  return grouped.replace(/,/g, "").includes(q.replace(/,/g, ""));
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
