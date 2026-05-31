// ── CSV transform + enrichment tools ─────────────────────────────

export const CSV_TOOL_DEFS = [
  {
    name: "analyze_csv",
    description:
      "Analyze a source CSV file in .capy/import/sources/. Returns: column headers, first 20 sample rows, total row count, and detected delimiter. Use this to understand the file format before defining a mapping.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name (e.g. '2019.csv'). Located in .capy/import/sources/.",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "preview_transform",
    description:
      "Apply a column mapping to the first N rows of a source CSV file and return the transformed result. Use this to verify the mapping is correct before running the full transform. Returns transformed rows as JSON + any parse errors.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name in .capy/import/sources/",
        },
        mapping: {
          type: "object",
          description: "The CsvMapping object defining how to transform columns",
        },
        limit: {
          type: "number",
          description: "Number of rows to preview (default: 10)",
        },
      },
      required: ["filename", "mapping"],
    },
  },
  {
    name: "transform_csv",
    description:
      "Apply a column mapping to ALL rows of a source CSV file and write to .capy/import/transactions.csv. Appends if the file already exists (for multi-file imports). Use preview_transform first to verify the mapping.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name in .capy/import/sources/",
        },
        mapping: {
          type: "object",
          description: "The CsvMapping object defining how to transform columns",
        },
      },
      required: ["filename", "mapping"],
    },
  },
  {
    name: "auto_enrich",
    description:
      "Code-based enrichment: (1) maps sourceCategory → budget categories, (2) matches sourceAccount → budget accounts, (3) resolves transfer target accounts. Leaves merchant empty for the model to fill with cleaned names. Runs automatically when an enrichment session starts. Call it again only if you suspect it didn't run (e.g., after a manual `write_import_file`).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "enrich_stats",
    description:
      "Returns a compact summary of enrichment progress: total rows, how many have merchants, categories, accounts, and how many still need work.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "enrich_sample",
    description:
      "Returns a small CSV sample of rows that still need enrichment. Use this to spot patterns, then apply bulk updates. Returns at most `limit` rows as CSV (default 20).",
    inputSchema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          description:
            "Which empty field to filter by: 'merchant', 'categoryId', 'targetAccountId' (unmatched transfers), or 'any' (default: 'any')",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default: 20)",
        },
      },
    },
  },
  {
    name: "enrich_update",
    description:
      "Bulk update: set field(s) on all rows matching a condition. Like SQL UPDATE ... WHERE. Only sets empty fields (won't overwrite existing values). Returns per-field counts of what was set vs skipped — read this to see exactly what landed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        set: {
          type: "object",
          description:
            "Fields to set. Keys: merchant, categoryId, categoryConfidence, accountId, targetAccountId. Example: {\"merchant\": \"Starbucks\", \"categoryId\": \"<uuid>\", \"categoryConfidence\": \"high\"}. categoryId must be a real UUID from list_categories.",
        },
        where: {
          oneOf: [
            {
              type: "object",
              properties: {
                field: { type: "string" },
                equals: { type: "string" },
                contains: { type: "string" },
              },
              required: ["field"],
            },
            {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  equals: { type: "string" },
                  contains: { type: "string" },
                },
                required: ["field"],
              },
            },
          ],
          description:
            "Single condition or array of conditions (AND logic). Each: {field, equals?, contains?}. Example: {\"field\": \"description\", \"contains\": \"STARBUCKS\"} or [{\"field\": \"description\", \"contains\": \"AMAZON\"}, {\"field\": \"type\", \"equals\": \"expense\"}]",
        },
      },
      required: ["set", "where"],
    },
  },
] as const
