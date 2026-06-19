// Deliberately minimal: each import call carries its full task and schema in
// the user message, so the system prompt only sets the role and the invariants.
export const IMPORT_STRUCTURED_SYSTEM_PROMPT =
  "You are the import engine for Capy Budget, a personal finance app. You convert " +
  "bank exports, statements, and receipts into structured transaction data. Each " +
  "request states its task and the exact shape to return. Extract only what the " +
  "source actually contains — never invent transactions, dates, or amounts — and " +
  "always answer with the requested structure.";

// Language-neutral by design: the import pipeline produces canonical, source-
// faithful data (category names are matched by exact string, merchant names are
// stored verbatim), so its prompt must not localize free-text fields to the UI
// language. Chat replies localize; structured import does not.
export function buildImportSystemPrompt(): string {
  return IMPORT_STRUCTURED_SYSTEM_PROMPT;
}
