// ── Import on-ramp tool ──────────────────────────────────────────
// The chat door into the import pipeline: stage the turn's attachments
// and kick the orchestrator. File data never flows through chat into the
// budget directly — `start_import` hands it to the same staging pipeline
// the Import tab uses.

/** The chat on-ramp tool. Named once here so the app can intercept its
 *  `tool-result` (navigate to the Import tab) without a magic string. */
export const START_IMPORT_TOOL_NAME = "start_import"

export const IMPORT_TOOL_DEFS = [
  {
    name: START_IMPORT_TOOL_NAME,
    description:
      "Start importing the file(s) the user attached to this message. Call this for any uploaded receipt, bank screenshot, or CSV/text export instead of reading it and creating transactions yourself. It copies the attachments into the import staging area and kicks off the normalize → dedupe → categorize pipeline; the user reviews and merges the result in the Import tab. Takes no arguments — it uses the files already attached to the message. Chat accepts only images and text files; if the user wants to import a PDF statement, tell them to drop it directly into the Import tab (chat can't take PDFs). If an import is already in progress (or files are already staged in the Import tab), it does not start — it returns guidance to relay to the user instead of replacing that import. After calling this, tell the user the file is uploaded and the import is starting, and point them to the Import tab.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const
