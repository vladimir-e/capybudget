// ── Import on-ramp tool ──────────────────────────────────────────
// The chat door into the import pipeline: stage the turn's attachments
// and kick the orchestrator. File data never flows through chat into the
// budget directly — `start_import` hands it to the same staging pipeline
// the Import tab uses.

import type { ToolDefinition } from "./index"

/** The chat on-ramp tool. Named once here so the app can intercept its
 *  `tool-result` (navigate to the Import tab) without a magic string. */
export const START_IMPORT_TOOL_NAME = "start_import"

/**
 * The `start_import` descriptor, keyed on whether the session's provider can
 * read PDFs (`canReadPdf`). The PDF guidance is the only part that varies: a
 * capable provider takes PDF statements in chat like any other statement file;
 * an incapable one (Claude CLI) can't — and neither can the Import tab under it,
 * so the model must send the user to a PDF-capable provider, not the tab.
 */
export function importToolDefs(pdfSupported: boolean): readonly ToolDefinition[] {
  const fileKinds = pdfSupported
    ? "receipt, bank screenshot, PDF statement, or CSV/text export"
    : "receipt, bank screenshot, or CSV/text export"
  const pdfGuidance = pdfSupported
    ? "Chat accepts images, text/CSV exports, and PDF statements — call this for an attached PDF statement exactly like any other statement file."
    : "Chat accepts images and text/CSV files, not PDFs. If the user attaches a PDF statement, don't start an import and don't send them to the Import tab — it can't read PDFs under the current AI provider either. Tell them PDF import needs the Anthropic or OpenAI provider (switchable in Settings → AI)."
  return [
    {
      name: START_IMPORT_TOOL_NAME,
      description:
        `Start importing the file(s) the user attached to this message. Call this for any uploaded ${fileKinds} instead of reading it and creating transactions yourself. It copies the attachments into the import staging area and kicks off the normalize → dedupe → categorize pipeline; the user reviews and merges the result in the Import tab. Takes no arguments — it uses the files already attached to the message. ${pdfGuidance} If an import is already in progress (or files are already staged in the Import tab), it does not start — it returns guidance to relay to the user instead of replacing that import. After calling this, tell the user the file is uploaded and the import is starting, and point them to the Import tab.`,
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ]
}
