// ── Import working directory tools ───────────────────────────────
// File I/O scoped to .capy/import/ (the staging area for the import
// flow). Used by both the chat-driven import normalize/enrich sessions
// and external MCP agents (Claude Desktop, Cursor) when they want to
// peek at intermediate state.

/** The chat on-ramp tool. Named once here so the app can intercept its
 *  `tool-result` (navigate to the Import tab) without a magic string. */
export const START_IMPORT_TOOL_NAME = "start_import"

export const IMPORT_TOOL_DEFS = [
  {
    name: "read_import_file",
    description:
      "Read a file from the import working directory (.capy/import/). Use this to read previously normalized or enriched data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to read (e.g. 'transactions.csv')",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "write_import_file",
    description:
      "Write a file to the import working directory (.capy/import/). Overwrites if the file exists. Use this to write normalized transaction data as CSV.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to write (e.g. 'transactions.csv')",
        },
        content: {
          type: "string",
          description: "File content to write",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "append_import_file",
    description:
      "Append content to a file in the import working directory (.capy/import/). Creates the file if it doesn't exist.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to append to",
        },
        content: {
          type: "string",
          description: "Content to append",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "list_import_files",
    description:
      "List files in the import working directory (.capy/import/).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: START_IMPORT_TOOL_NAME,
    description:
      "Start importing the file(s) the user attached to this message. Call this for ANY uploaded file — a receipt, a bank screenshot, a CSV, a statement — instead of reading it and creating transactions yourself. It copies the attachments into the import staging area and kicks off the normalize → dedupe → categorize pipeline; the user reviews and merges the result in the Import tab. Takes no arguments — it uses the files already attached to the message. After calling it, tell the user the file is uploaded and the import is starting, and point them to the Import tab.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const
