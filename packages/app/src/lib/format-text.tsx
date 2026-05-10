/**
 * Inline markdown renderer for chat text — supports `**bold**` and
 * `*italic*` only. Bolded content that looks like a financial figure
 * (dollar amount, percentage, ratio) is emphasized in the brand color.
 *
 * Why a roll-your-own renderer rather than `react-markdown`: we only
 * need two inline transforms over `whitespace-pre-wrap` text. Pulling
 * in a full markdown stack for that is overkill — bigger bundle, more
 * surface area, and we'd have to override a dozen heading/list/link
 * components to keep the output bounded to the chat surface.
 *
 * Matching strategy: a single regex scans for either `**...**` or
 * `*...*` non-greedily so `**a**b**c**` produces two separate bold
 * spans (and `*a*b*c*` two italics). Trailing/unbalanced markers are
 * left as literal text — no error, just rendered as-is.
 */
import type { ReactNode } from "react"

// Matches the first inline span of either bold (`**...**`) or
// italic (`*...*`). The `**` alternation comes first so the engine
// prefers the longer marker. Both groups capture their inner text.
//
// The character classes (`[^*]` etc.) prevent crossing a marker — a
// stray `*` inside bold ends the match early, which keeps the
// non-greedy behavior consistent.
const INLINE_RE = /\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*|\*([^*\s][^*]*?)\*/

/**
 * Currency / percentage / ratio detector. Matches:
 *   $1,234.56          dollar amount
 *   $1,234.56/mo       per-period figure
 *   32%                percentage
 *   $2,941/month       per-period figure (slash + word)
 *   2.5x               multiplier
 *   2x                 multiplier
 *   1,234              bare number (only when accompanied by a unit nearby — see below)
 *
 * The regex is intentionally narrow: bare numbers are NOT marked as
 * money on their own (too many false positives — bolding "ten 4s"
 * shouldn't recolor "4s"). The leading `$` or trailing `%`/unit is
 * the discriminator.
 */
const MONEY_RE = /^\$?[\d,]+(?:\.\d+)?(?:%|x|\s*\/\s*\w+)?$/

function looksLikeMoney(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Require either a leading $, a trailing %, x, or a slash unit —
  // a bare "1,234" by itself would otherwise match.
  if (!/^\$/.test(trimmed) && !/(%|x|\/\s*\w+)$/.test(trimmed)) {
    return false
  }
  return MONEY_RE.test(trimmed)
}

/**
 * Render a string with inline `**bold**` and `*italic*` formatting.
 * Bolded content that looks like a financial figure renders in the
 * brand color in addition to bold.
 */
export function formatText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const match = INLINE_RE.exec(remaining)
    if (!match) {
      out.push(remaining)
      break
    }

    const [full, boldInner, italicInner] = match
    const start = match.index
    if (start > 0) {
      out.push(remaining.slice(0, start))
    }

    if (boldInner !== undefined) {
      const className = looksLikeMoney(boldInner)
        ? "font-semibold text-brand"
        : "font-semibold text-foreground"
      out.push(
        <strong key={`b-${key++}`} className={className}>
          {boldInner}
        </strong>,
      )
    } else if (italicInner !== undefined) {
      out.push(
        <em key={`i-${key++}`} className="italic">
          {italicInner}
        </em>,
      )
    }

    remaining = remaining.slice(start + full.length)
  }

  return out
}
