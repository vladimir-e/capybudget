import type { Transaction } from "@/lib/types";

/**
 * Extract unique, non-empty merchant names from transactions.
 * Sorted alphabetically, case-insensitive.
 */
export function getUniqueMerchants(transactions: Transaction[]): string[] {
  const seen = new Map<string, string>(); // lowercase → original casing (last wins)
  for (const t of transactions) {
    if (t.merchant) seen.set(t.merchant.toLowerCase(), t.merchant);
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * Match merchants against a query string.
 * Priority: word-start matches first, then substring matches.
 * Case-insensitive.
 */
export function matchMerchants(
  merchants: string[],
  query: string,
): string[] {
  if (!query) return merchants;
  const q = query.toLowerCase();

  const wordStart: string[] = [];
  const substring: string[] = [];

  for (const m of merchants) {
    const lower = m.toLowerCase();
    if (lower.split(/\s+/).some((w) => w.startsWith(q))) {
      wordStart.push(m);
    } else if (lower.includes(q)) {
      substring.push(m);
    }
  }

  return [...wordStart, ...substring];
}

/**
 * Find the categoryId from the most recent transaction with the given merchant.
 * Returns empty string if no match or the matched transaction has no category.
 *
 * Designed to be reusable for auto-categorization during CSV import.
 */
export function findCategoryForMerchant(
  transactions: Transaction[],
  merchant: string,
): string {
  if (!merchant) return "";
  const normalized = merchant.toLowerCase();

  // Walk backwards — transactions are typically ordered chronologically,
  // so the last match is the most recent.
  for (let i = transactions.length - 1; i >= 0; i--) {
    const t = transactions[i];
    if (t.merchant.toLowerCase() === normalized && t.categoryId) {
      return t.categoryId;
    }
  }
  return "";
}
