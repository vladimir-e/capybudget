import type { Account } from "./types";

/**
 * Build a mapping of sourceAccount strings to account IDs by matching
 * against existing account names (case-insensitive, trimmed).
 */
export function matchAccountsByName(
  sourceAccounts: string[],
  accounts: Account[],
): Record<string, string> {
  const byName = new Map(
    accounts.map((a) => [a.name.toLowerCase().trim(), a.id]),
  );
  const mapping: Record<string, string> = {};
  for (const source of sourceAccounts) {
    if (!source) continue;
    const match = byName.get(source.toLowerCase().trim());
    if (match) mapping[source] = match;
  }
  return mapping;
}
