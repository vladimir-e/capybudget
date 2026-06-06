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
 * Terminal signal the model emits when every staging row is a duplicate — the
 * import has nothing new to add. The store/preview can match this exact phrase
 * to render it as a result rather than a log line (Unit 5). Kept as a single
 * recognizable token so the seam is clean.
 */
export const NOTHING_TO_IMPORT_SIGNAL =
  "already in your budget — nothing to import"

export const DEDUP_INSTRUCTION = `## Your task right now: review duplicates

Some imported rows may already exist in the budget (a re-downloaded statement, an overlapping date range). High-confidence exact matches (same date + amount + description + account) were already auto-marked before you arrived — those are done. Your job is the **low-confidence** candidates: judgment calls the matcher flagged but won't decide on its own (date off by a day, amount matches but description differs, fuzzy description).

## Steps

1. **\`find_duplicates\`** — see the candidate set, grouped by confidence. Each candidate shows the matched original's date, amount, merchant, and category, so you can tell what a row would duplicate. The high-confidence group is already marked (informational); focus on the **low** group.
2. For each low-confidence candidate, decide: is this genuinely the same transaction the user already has? Use the matched original's merchant/amount/date as context. A re-download of the same statement produces real duplicates; two legitimately separate $5 coffees on adjacent days do not.
3. **\`mark_duplicates\`** — pass the ids you judged to be genuine duplicates. The tool sets the dup flags and copies the matched original's merchant + category onto the row (so a dimmed row shows what it duplicates, and a false-positive merge is already categorized).

Skip candidates that are plausibly distinct. A false negative (a real duplicate slips through) is a row the user unselects in the preview; a false positive (a distinct transaction dimmed) is money silently dropped from the import. When unsure, don't mark.

## If everything is a duplicate

If \`find_duplicates\` reports that **every** staging row is already marked (the whole import overlaps what's in the budget), stop here. Don't proceed to enrich — there's nothing new to import. Report exactly: \`"All N transactions are ${NOTHING_TO_IMPORT_SIGNAL}."\` and end your turn.

## Rules

- Only mark rows the finder surfaced as candidates — \`mark_duplicates\` silently skips ids that aren't current matches, so don't invent ids.
- Be brief. One short status line is plenty; the tools carry the data.
- This is dedup only. Leave merchant/category cleanup of the non-duplicate rows to the enrich phase next.`
