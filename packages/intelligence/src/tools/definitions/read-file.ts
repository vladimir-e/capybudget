// ── read_file ────────────────────────────────────────────────────
// Mirrors what Claude Code provides natively via its `Read` tool. API
// adapters need an in-process equivalent. Scoped to the budget folder.

export const READ_FILE_TOOL_DEF = {
  name: "read_file",
  description:
    "Read a text file inside the budget folder (or .capy/import/sources/). Use this for any text-based source files during the import flow — CSV, OFX, JSON, etc.",
  inputSchema: {
    type: "object" as const,
    properties: {
      filename: {
        type: "string",
        description:
          "File name relative to the budget folder or import sources folder. Bare filenames resolve against .capy/import/sources/ first, then the budget folder.",
      },
    },
    required: ["filename"],
  },
} as const
