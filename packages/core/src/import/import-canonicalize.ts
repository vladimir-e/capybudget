/**
 * Canonicalization for history grounding.
 *
 * The stored `description` (trim-45) is the readable form; matching runs on a
 * separate *match key* derived from it — lowercased, whitespace-collapsed, with
 * leading processor prefixes and trailing reference-number noise stripped. New
 * rows and historical merchant / note text normalize through the same function,
 * which is the whole point: trimmed-vs-trimmed, normalized-vs-normalized, so
 * signal lines up.
 */

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

/**
 * Well-known leading processor prefixes that dilute the match against clean
 * history merchants. A real export reads `CHECK CARD PURCHASE NETFLIX`; clean
 * history reads `Netflix`. Without stripping, the prefix tokens drag token
 * overlap below threshold and the row misses.
 *
 * Two shapes: word prefixes (peeled with their following separator) and
 * gateway tags like `SQ *` / `TST*` / `PAYPAL *` (the `*` is the tell). Only
 * conservative, well-known prefixes — never a guess that could be a merchant.
 */
const LEADING_WORD_PREFIXES = [
  "purchase authorized on",
  "recurring payment authorized on",
  "debit card purchase",
  "credit card purchase",
  "check card purchase",
  "checkcard",
  "pos debit",
  "pos purchase",
  "pos",
  "ach debit",
  "ach credit",
  "debit purchase",
  "point of sale",
  "preauthorized",
  "purchase",
];

/**
 * Strip leading processor prefixes and gateway tags. Symmetric to the trailing
 * strip and guarded the same way — the caller falls back to the unstripped form
 * if this empties the string, so a real single-merchant name is never lost.
 */
function stripLeadingProcessorPrefix(s: string): string {
  let out = s;
  let prev: string;
  do {
    prev = out;
    // Gateway tag: a short code glued to `*` (SQ *, TST*, PAYPAL *). The `*` is
    // the tell — a real merchant name is not a <=6-char token bound to a star.
    out = out.replace(/^[a-z0-9]{2,6}\s*\*\s*/iu, "");
    for (const prefix of LEADING_WORD_PREFIXES) {
      if (out.startsWith(prefix)) {
        const rest = out.slice(prefix.length);
        // Only a prefix if a separator follows — never bite into a merchant
        // whose name merely starts with one of these words.
        if (rest === "" || /^[\s,;:*-]/u.test(rest)) {
          out = rest.replace(/^[\s,;:*-]+/u, "");
          break;
        }
      }
    }
    // A leading date that still has a merchant after it ("03/15 spotify" left by
    // "purchase authorized on 03/15 spotify"). Only when more text follows.
    out = out.replace(/^\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?(?=\s)\s*/u, "");
    out = out.trim();
  } while (out !== prev && out.length > 0);
  return out;
}

/**
 * Strip trailing reference-number noise: confirmation codes, auth numbers, card
 * tails, dates appended after the merchant name. These vary per transaction and
 * would otherwise wreck token/trigram overlap against the same merchant.
 *
 * Conservative — only trailing runs that look like references, never the middle
 * of a name (e.g. "7-Eleven", "Store #5" keeps the store, drops "#001234567").
 */
function stripTrailingReferenceNoise(s: string): string {
  let out = s;
  // Repeatedly peel trailing reference-ish tokens.
  let prev: string;
  do {
    prev = out;
    out = out
      // trailing "ref/auth/conf/trace/txn/id <token>"
      .replace(/[\s,;:-]*(?:ref|auth|conf(?:irmation)?|trace|txn|trans|id|no|seq)\.?\s*[#:]?\s*[a-z0-9-]+$/iu, "")
      // trailing card tail "xxxx1234" / "x1234" / "ending 1234"
      .replace(/[\s,;:-]*(?:x{2,}|ending|card)\s*\d{3,}$/iu, "")
      // trailing isolated date "01/15", "2025-01-15"
      .replace(/[\s,;:-]*\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{1,4})?$/u, "")
      // trailing long digit run (>= 4), optionally prefixed by # or *
      .replace(/[\s#*-]*[#*]?\d{4,}$/u, "")
      // orphaned reference keywords left dangling after their number was peeled
      .replace(/[\s,;:-]*(?:ref|auth|conf(?:irmation)?|trace|txn|trans|ending|card|seq)\.?$/iu, "")
      .trim();
  } while (out !== prev && out.length > 0);
  return out;
}

/**
 * Normalize a display name (e.g. an account name like "🍏 Apple Card") for
 * matching: emoji stripped, lowercased, whitespace collapsed. Unlike
 * {@link canonicalizeMatchKey} there is no noise stripping — names legitimately
 * end in words ("Card") the description canonicalizer treats as reference noise.
 */
export function canonicalizeName(raw: string): string {
  return raw.replace(EMOJI_RE, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Derive the normalized match key from a stored/historical description. */
export function canonicalizeMatchKey(raw: string): string {
  const collapsed = canonicalizeName(raw);

  const deprefixed = stripLeadingProcessorPrefix(collapsed);
  // If a prefix strip empties the string, the whole thing was a prefix — keep
  // the collapsed form rather than lose the only signal.
  const base = deprefixed.length > 0 ? deprefixed : collapsed;

  const stripped = stripTrailingReferenceNoise(base);
  // Same guard for trailing noise that consumed everything.
  return stripped.length > 0 ? stripped : base;
}

/** Significant tokens of a match key — alphanumerics, length >= 2. */
export function tokenize(key: string): string[] {
  return key
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2);
}

/** Character trigrams of a match key (whitespace removed). The trigram set is
 *  what catches near-spellings and concatenated merchant strings that token
 *  overlap alone would miss. */
export function trigrams(key: string): string[] {
  const compact = key.replace(/\s+/g, "");
  if (compact.length < 3) return compact.length > 0 ? [compact] : [];
  const grams: string[] = [];
  for (let i = 0; i <= compact.length - 3; i++) {
    grams.push(compact.slice(i, i + 3));
  }
  return grams;
}
