/**
 * The system prompt for the structured import session.
 *
 * Unlike the chat/agent prompts, the stateless import calls carry their full
 * instructions in the user message — `normalizeCsv` / `normalizeImage` describe
 * the mapping/extraction task and `enrichBatch` describes the classification
 * task, each alongside its schema. So the system prompt only has to set the
 * role and the two invariants that hold across every call: ground truth over
 * invention, and obey the requested structure. Keeping it short also keeps the
 * per-call token floor low — the point of the redesign.
 */
export const IMPORT_STRUCTURED_SYSTEM_PROMPT =
  "You are the import engine for Capy Budget, a personal finance app. You convert " +
  "bank exports, statements, and receipts into structured transaction data. Each " +
  "request states its task and the exact shape to return. Extract only what the " +
  "source actually contains — never invent transactions, dates, or amounts — and " +
  "always answer with the requested structure.";

/**
 * The import system prompt with the user's language folded in. Field values the
 * model generates (e.g. a cleaned merchant name) follow that language; the
 * requested JSON structure and keys stay as specified. `undefined`/English
 * leaves the base prompt untouched.
 */
export function buildImportSystemPrompt(language?: string): string {
  if (!language || language === "English") return IMPORT_STRUCTURED_SYSTEM_PROMPT;
  return (
    IMPORT_STRUCTURED_SYSTEM_PROMPT +
    ` Write any free-text field values you generate in ${language}.`
  );
}
