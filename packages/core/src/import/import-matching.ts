import type { Account, Category } from "../entities/types";

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

/**
 * Match a source category string to a budget category by name similarity.
 *
 * Handles colon-separated groups (e.g. "Immediate Obligations: Groceries" →
 * matches on the trailing "Groceries") and emoji. Scoring: exact = 100,
 * substring = 50+ scaled by length ratio, word-overlap = 10+ scaled by overlap.
 * Returns the best category above a minimum threshold, or null.
 */
export function matchSourceCategory(
  sourceCategory: string,
  categories: Category[],
): Category | null {
  if (!sourceCategory) return null;

  const parts = sourceCategory.split(":");
  const specific = normalize(parts[parts.length - 1]);
  if (!specific) return null;

  let bestMatch: Category | null = null;
  let bestScore = 0;

  for (const cat of categories) {
    const catLower = cat.name.toLowerCase();
    let score = 0;

    if (catLower === specific) {
      score = 100;
    } else if (specific.includes(catLower)) {
      score = 50 + Math.round((catLower.length / specific.length) * 30);
    } else if (catLower.includes(specific)) {
      score = 50 + Math.round((specific.length / catLower.length) * 30);
    } else {
      const sourceWords = new Set(specific.split(/\s+/).filter((w) => w.length > 2));
      const catWords = catLower.split(/\s+/).filter((w) => w.length > 2);
      if (sourceWords.size > 0 && catWords.length > 0) {
        let overlap = 0;
        for (const word of catWords) {
          if (sourceWords.has(word)) overlap++;
        }
        if (overlap > 0) {
          score = 10 + Math.round((overlap / catWords.length) * 30);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = cat;
    }
  }

  return bestScore >= 10 ? bestMatch : null;
}
