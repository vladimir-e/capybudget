import type { Account } from "../entities/types";

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

function normalize(s: string): string {
  return s.replace(EMOJI_RE, "").toLowerCase().trim();
}

/**
 * Build a mapping of sourceAccount strings to account IDs by matching
 * against existing account names. Strips emojis, case-insensitive.
 * Tries exact match first, then substring match (either direction).
 */
export function matchAccountsByName(
  sourceAccounts: string[],
  accounts: Account[],
): Record<string, string> {
  const normalized = accounts.map((a) => ({ id: a.id, norm: normalize(a.name) }));
  const mapping: Record<string, string> = {};

  for (const source of sourceAccounts) {
    if (!source) continue;
    const sourceNorm = normalize(source);

    // Exact match
    const exact = normalized.find((a) => a.norm === sourceNorm);
    if (exact) { mapping[source] = exact.id; continue; }

    // Substring match (either direction)
    const sub = normalized.find((a) =>
      a.norm.includes(sourceNorm) || sourceNorm.includes(a.norm),
    );
    if (sub) mapping[source] = sub.id;
  }

  return mapping;
}
