/**
 * The dedup phase of the Smart Import run.
 *
 * `DEDUP_INSTRUCTION` is the duplicate-review task body — the orchestrator
 * injects it as a user turn into the single import session after the accounts
 * phase resolves every row's `accountId` and the deterministic pre-step
 * (`auto_mark_duplicates`) has already marked the exact, high-confidence
 * matches. The session carries the memory of normalize + account mapping, so
 * this block is task-only.
 *
 * The split is the principle "matcher FINDS, model ADJUDICATES": code marks
 * the unambiguous duplicates; the model reviews the judgment calls.
 */

/**
 * Canonical "nothing to import" phrase for the all-duplicate halt. The
 * orchestrator — not the model — decides the halt and sets this message
 * (`buildNothingToImportMessage`), so the terminal text is a reliable
 * code-set value. Unit 5 renders the resulting `runOutcome` prominently;
 * the constant is the shared phrase, not a string the model is asked to emit.
 */
export const NOTHING_TO_IMPORT_SIGNAL =
  "already in your budget — nothing to import"

/** The orchestrator's terminal message for the all-duplicate halt. */
export function buildNothingToImportMessage(count: number): string {
  const noun = count === 1 ? "transaction is" : "transactions are"
  return `All ${count} ${noun} ${NOTHING_TO_IMPORT_SIGNAL}.`
}

export const DEDUP_INSTRUCTION = `## Your task right now: review duplicates

Some imported rows may already exist in the budget (a re-downloaded statement, an overlapping date range). High-confidence exact matches (same date + amount + description + account) were already auto-marked before you arrived — those are done. Your job is the **low-confidence** candidates: judgment calls the matcher flagged but won't decide on its own (date off by a day, amount matches but description differs, fuzzy description).

## Steps

1. **\`find_duplicates\`** — see the candidate set, grouped by confidence. Each candidate shows the matched original's date, amount, merchant, and category, so you can tell what a row would duplicate. The high-confidence group is already marked (informational); focus on the **low** group.
2. For each low-confidence candidate, decide: is this genuinely the same transaction the user already has? Use the matched original's merchant/amount/date as context. A re-download of the same statement produces real duplicates; two legitimately separate $5 coffees on adjacent days do not.
3. **\`mark_duplicates\`** — pass the ids you judged to be genuine duplicates. The tool sets the dup flags and copies the matched original's merchant + category onto the row (so a dimmed row shows what it duplicates, and a false-positive merge is already categorized).

Skip candidates that are plausibly distinct. A false negative (a real duplicate slips through) is a row the user unselects in the preview; a false positive (a distinct transaction dimmed) is money silently dropped from the import. When unsure, don't mark.

Then end your turn. The orchestrator advances the run — it checks the staging rows after you finish and either moves on to enrich or, if every row is now a duplicate, stops with the "nothing to import" result. You don't decide that or report it; just mark the genuine duplicates and stop.

## Rules

- Only mark rows the finder surfaced as candidates — \`mark_duplicates\` silently skips ids that aren't current matches, so don't invent ids.
- Communicate only via \`report_status\` (e.g. "Found 12 overlaps, marking them…") — no prose. The tools carry the data.
- This is dedup only. Leave merchant/category cleanup of the non-duplicate rows to the enrich phase next.`
