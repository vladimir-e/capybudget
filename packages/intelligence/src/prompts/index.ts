/**
 * Barrel module for the intelligence layer's three system prompts.
 *
 * - `chat.ts` — Capy chat overlay (the conversational assistant)
 * - `import.ts` — Smart Import normalization step
 * - `accounts.ts` — Smart Import account-mapping step
 * - `enrich.ts` — Smart Import enrichment step
 *
 * All three open with the shared `APP_KNOWLEDGE` brief (`app-knowledge.ts`)
 * so each understands the app and its role from one source.
 *
 * `buildContext` from chat.ts is reused by the import flow to wrap kickoff
 * messages with the standard context header; `buildBudgetSnapshot` /
 * `BudgetSnapshot` let the app attach a data snapshot to the first message.
 */

export { SYSTEM_PROMPT, buildContext } from "./chat"
export { IMPORT_SYSTEM_PROMPT } from "./import"
export { ACCOUNTS_INSTRUCTION } from "./accounts"
export { ENRICH_SYSTEM_PROMPT, ENRICH_INSTRUCTION } from "./enrich"
export { APP_KNOWLEDGE } from "./app-knowledge"
export { buildBudgetSnapshot, formatBudgetSnapshot } from "./budget-snapshot"
export type { BudgetSnapshot } from "./budget-snapshot"
