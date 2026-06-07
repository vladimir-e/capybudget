/**
 * Canonicalization for history grounding.
 *
 * The stored `description` (trim-45) is the readable form; matching runs on a
 * separate *match key* derived from it — lowercased, whitespace-collapsed, with
 * trailing reference-number noise stripped. New rows and historical merchant /
 * note text normalize through the same function, which is the whole point:
 * trimmed-vs-trimmed, normalized-vs-normalized, so signal lines up.
 */

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

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

/** Derive the normalized match key from a stored/historical description. */
export function canonicalizeMatchKey(raw: string): string {
  const lowered = raw.replace(EMOJI_RE, "").toLowerCase();
  const collapsed = lowered.replace(/\s+/g, " ").trim();
  const stripped = stripTrailingReferenceNoise(collapsed);
  // If stripping ate everything (the whole string was reference noise), fall
  // back to the collapsed form — a key is better than nothing.
  return stripped.length > 0 ? stripped : collapsed;
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
