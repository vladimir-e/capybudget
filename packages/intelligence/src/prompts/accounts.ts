/**
 * The accounts phase of the Smart Import run.
 *
 * `ACCOUNTS_INSTRUCTION` is the account-mapping task body — the orchestrator
 * injects it as a user turn into the single import session after normalize is
 * done and the deterministic alias pre-step (`apply_account_aliases`) has run.
 * The session already carries the app-knowledge brief and the memory of what
 * normalize did, so this block is task-only.
 *
 * This replaces the old name-based fuzzy matcher: account mapping is now agent
 * judgment, persisted onto the staging rows' `accountId`.
 */

export const ACCOUNTS_INSTRUCTION = `## Your task right now: map accounts

Each imported row carries a \`sourceAccount\` string (the account name from the statement). Map every distinct \`sourceAccount\` to one of the user's Capy accounts by setting \`accountId\` on its rows. Imports are small — usually one source account, occasionally a few — so this is a handful of decisions, not a batch job.

Stored aliases for previously-mapped source accounts were already applied before you arrived: those rows have \`accountId\` set, and \`enrich_update\` will skip them (it only fills empty fields). Your job is the rest.

## Steps

1. **\`list_accounts\`** — get the user's accounts with their UUIDs and names.
2. Recall the distinct \`sourceAccount\` values from normalize. If you're unsure which remain unmapped after the alias pre-step, call \`enrich_status\` to see account coverage.
3. For each unmapped \`sourceAccount\`, pick the matching Capy account and persist it:

\`\`\`json
{
  "set": { "accountId": "<account-uuid>" },
  "where": { "field": "sourceAccount", "equals": "<source account name>" }
}
\`\`\`

\`enrich_update\` only fills empty \`accountId\`s, so aliased rows stay untouched — exactly right.

## Judgment is the point

Source account names are messy. Match through emojis, case, abbreviations, and variants — this is exactly what you're good at and the fuzzy matcher was not:

- "💰 BofA Savings" → the "BofA Savings" account
- "CHK ...1234" / "Checking" → the "Chase Checking" account
- "AMEX" / "Amex Plat" → the "American Express" account

When a \`sourceAccount\` clearly corresponds to an existing account, map it — don't be timid about reasonable matches.

## No matching account → create

If a \`sourceAccount\` has no plausible Capy account (it's a new account the user hasn't set up yet), set its \`accountId\` to the literal \`"__create__"\` sentinel — the merge step creates the account from the source name. Use this only when there's genuinely no existing account to map to.

\`\`\`json
{ "set": { "accountId": "__create__" }, "where": { "field": "sourceAccount", "equals": "<source account name>" } }
\`\`\`

## Rules

- Use real account UUIDs from \`list_accounts\` (or the \`"__create__"\` sentinel). Don't invent IDs.
- Don't touch rows that already have an \`accountId\` — those are the user's stored aliases and win over your judgment.
- This is account mapping only. Leave \`merchant\`, \`categoryId\`, and transfer targets alone — the enrich phase handles those next.
- Be brief. One short status line per decision is plenty; the tools carry the data.`
