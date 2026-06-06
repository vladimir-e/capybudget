// ── Import working directory tools ───────────────────────────────
// File I/O scoped to .capy/import/ (the staging area for the import
// flow). Used by both the chat-driven import normalize/enrich sessions
// and external MCP agents (Claude Desktop, Cursor) when they want to
// peek at intermediate state.

export const IMPORT_TOOL_DEFS = [
  {
    name: "read_import_file",
    description:
      "Read a file from the import working directory (.capy/import/), e.g. normalized or enriched data.",
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
      "Write transaction data to the import working directory (.capy/import/). mode 'overwrite' (default) replaces the file; 'append' adds to it, creating it if absent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to write (e.g. 'transactions.csv')",
        },
        content: {
          type: "string",
          description: "File content",
        },
        mode: {
          type: "string",
          enum: ["overwrite", "append"],
          description: "'overwrite' (default) or 'append'",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "list_import_files",
    description: "List files in the import working directory (.capy/import/).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "report_status",
    description:
      "Report one short progress line to the user during an import run. This is your ONLY way to communicate while importing — write no prose. One tight present-tense line per step, e.g. \"Reading your March statement…\", \"Mapping accounts…\", \"Found 12 overlaps, marking them…\", \"Categorizing 38 transactions…\". The UI shows the latest line and keeps the prior ones as a timestamped log.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description:
            "A single short human-readable status line (no markdown, no lists).",
        },
      },
      required: ["status"],
    },
  },
] as const
