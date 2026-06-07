/**
 * Barrel module for the intelligence layer's chat system prompt.
 *
 * `chat.ts` is the Capy chat overlay (the conversational assistant); it
 * opens with the shared `APP_KNOWLEDGE` brief (`app-knowledge.ts`). The
 * structured import session carries its own prompt (`import/system-prompt.ts`)
 * and builds each call's payload inline, so it doesn't live here.
 *
 * `buildContext` wraps a chat turn with the standard context header;
 * `buildBudgetSnapshot` / `BudgetSnapshot` let the app attach a data
 * snapshot to the first message.
 */

export { SYSTEM_PROMPT, buildContext } from "./chat"
export { APP_KNOWLEDGE } from "./app-knowledge"
export { buildBudgetSnapshot, formatBudgetSnapshot } from "./budget-snapshot"
export type { BudgetSnapshot } from "./budget-snapshot"
