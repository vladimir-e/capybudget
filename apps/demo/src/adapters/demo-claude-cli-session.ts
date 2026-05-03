/**
 * Re-export shim so the demo's vite alias for `claude-cli-session`
 * resolves to a module that exports `ClaudeCliSession` — the symbol
 * name the renamed app code imports. The actual stubbed behavior
 * lives in `demo-capy-session.ts` (kept untouched).
 */

export { CapySession as ClaudeCliSession } from "./demo-capy-session"
