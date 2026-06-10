/**
 * Deterministic recognition of credit-card payment transfer legs.
 *
 * Bank exports phrase card payments as ordinary debits ("CAPITAL ONE
 * DES:MOBILE PMT", "APPLECARD GSBANK DES:PAYMENT"), so type detection's
 * description patterns miss them and they stage as expenses — inflating
 * spending and double-counting once the card's own statement is imported.
 * When the payment names one of the user's own budget accounts, code can
 * retype it without the model.
 *
 * Two signals must BOTH hold — the conjunction is the false-positive guard,
 * neither alone may fire:
 *   (i)  the description carries a payment keyword ({@link PAYMENT_KEYWORDS}),
 *   (ii) it names exactly ONE other budget account.
 *
 * Naming is containment-oriented, not symmetric similarity: the account name
 * is short and the description long, so Jaccard/Dice dilute to nothing.
 * Coverage of the *account's* tokens/trigrams within the description is what
 * counts — all trigrams of "applecard" appear in "APPLECARD GSBANK
 * DES:PAYMENT" (coverage 1.0) despite zero token overlap.
 */

import type { Account } from "../entities/types";
import {
  canonicalizeMatchKey,
  canonicalizeName,
  tokenize,
  trigrams,
} from "./import-canonicalize";

/** Payment-ish keywords (substring, case-insensitive) — signal (i). */
export const PAYMENT_KEYWORDS: readonly string[] = [
  "payment",
  "pmt",
  "pymt",
  "epay",
  "autopay",
];

/**
 * Minimum share of the account's significant tokens that must appear in the
 * description. 0.6 admits "Capital One" (2 of 3 tokens of "Capital One BJ's")
 * while rejecting a bare brand token ("Chase" alone is 1 of 3 of "Chase Prime
 * Rewards" — an accepted miss owned by the model's transferPatterns).
 */
const TOKEN_COVERAGE_MIN = 0.6;

/**
 * Minimum share of the account name's trigrams present in the description —
 * effectively "the compact name appears (near-)verbatim", which catches
 * concatenated bank spellings like APPLECARD against "Apple Card".
 */
const TRIGRAM_COVERAGE_MIN = 0.9;

/**
 * A single-token account name needs at least this many compact characters to
 * participate. A short name like "Cash" matching inside a longer description
 * is noise, not naming — "CASH APP *PAYMENT SENT" (a real P2P expense) must
 * not fire against a "Cash" account.
 */
const MIN_COMPACT_LENGTH = 6;

interface NameFeatures {
  id: string;
  tokens: string[];
  trigrams: string[];
}

/**
 * Matches descriptions against the budget's account names. Account features
 * are computed once per construction; {@link match} is then cheap per row.
 * Names go through {@link canonicalizeName} (emoji-strip only — "Apple Card"
 * must keep its trailing "Card"); descriptions through the full
 * {@link canonicalizeMatchKey}, the same key history matching runs on.
 */
export class PaymentLegMatcher {
  private readonly candidates: NameFeatures[];

  constructor(accounts: readonly Account[]) {
    this.candidates = accounts.flatMap((account) => {
      const key = canonicalizeName(account.name);
      const tokens = [...new Set(tokenize(key))];
      const compact = key.replace(/\s+/g, "");
      if (tokens.length < 2 && compact.length < MIN_COMPACT_LENGTH) return [];
      return [{ id: account.id, tokens, trigrams: [...new Set(trigrams(key))] }];
    });
  }

  /**
   * The id of the single account the description both payment-keywords and
   * names, excluding `ownAccountId` — or null. Two accounts clearing
   * threshold is ambiguity, not a pick: only a single confident match fires.
   */
  match(description: string, ownAccountId = ""): string | null {
    const key = canonicalizeMatchKey(description);
    if (!PAYMENT_KEYWORDS.some((keyword) => key.includes(keyword))) return null;

    const descTokens = new Set(tokenize(key));
    const descTrigrams = new Set(trigrams(key));

    let found: string | null = null;
    for (const candidate of this.candidates) {
      if (candidate.id === ownAccountId) continue;
      if (!isNamed(candidate, descTokens, descTrigrams)) continue;
      if (found) return null;
      found = candidate.id;
    }
    return found;
  }
}

/** Either containment channel can carry the match on its own. */
function isNamed(
  candidate: NameFeatures,
  descTokens: Set<string>,
  descTrigrams: Set<string>,
): boolean {
  return (
    coverage(candidate.tokens, descTokens) >= TOKEN_COVERAGE_MIN ||
    coverage(candidate.trigrams, descTrigrams) >= TRIGRAM_COVERAGE_MIN
  );
}

/** Share of `parts` present in `within`; 0 when there are no parts. */
function coverage(parts: string[], within: Set<string>): number {
  if (parts.length === 0) return 0;
  let hits = 0;
  for (const part of parts) if (within.has(part)) hits++;
  return hits / parts.length;
}
