/**
 * Barrel module for the intelligence layer's three system prompts.
 *
 * - `chat.ts` — Capy chat overlay (the conversational assistant)
 * - `import.ts` — Smart Import normalization step
 * - `enrich.ts` — Smart Import enrichment step
 *
 * `buildContext` from chat.ts is reused by the import store to wrap the
 * enrichment kickoff message with the standard context header.
 */

export { SYSTEM_PROMPT, buildContext } from "./chat"
export { IMPORT_SYSTEM_PROMPT } from "./import"
export { ENRICH_SYSTEM_PROMPT } from "./enrich"
