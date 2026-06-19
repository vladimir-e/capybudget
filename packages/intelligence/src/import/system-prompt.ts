// Deliberately minimal: each import call carries its full task and schema in
// the user message, so the system prompt only sets the role and the invariants.
export const IMPORT_STRUCTURED_SYSTEM_PROMPT =
  "You are the import engine for Capy Budget, a personal finance app. You convert " +
  "bank exports, statements, and receipts into structured transaction data. Each " +
  "request states its task and the exact shape to return. Extract only what the " +
  "source actually contains — never invent transactions, dates, or amounts — and " +
  "always answer with the requested structure.";

export function buildImportSystemPrompt(language?: string): string {
  if (!language || language === "English") return IMPORT_STRUCTURED_SYSTEM_PROMPT;
  return (
    IMPORT_STRUCTURED_SYSTEM_PROMPT +
    ` Write any free-text field values you generate in ${language}.`
  );
}
