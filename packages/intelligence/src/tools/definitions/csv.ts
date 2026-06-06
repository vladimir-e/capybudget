// ── CSV transform + enrichment tools ─────────────────────────────

export const CSV_TOOL_DEFS = [
  {
    name: "analyze_csv",
    description:
      "Inspect a source CSV in .capy/import/sources/. Returns column headers, first 20 sample rows, total row count, and delimiter — study before mapping.",
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
      "Apply a column mapping to the first N rows of a source CSV; returns transformed rows plus parse errors. Verify the mapping before transform_csv.",
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
      "Apply a column mapping to ALL rows of a source CSV and write .capy/import/transactions.csv (appends for multi-file imports). Run preview_transform first.",
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
      "Code-based enrichment: maps sourceCategory → categories, sourceAccount → accounts, and resolves transfer targets. Leaves merchant empty for you to clean.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "enrich_status",
    description:
      "Enrichment progress: total rows and merchant/category/account coverage. Set sampleSize > 0 to also get that many CSV sample rows still needing work (sampleField filters which empty field).",
    inputSchema: {
      type: "object" as const,
      properties: {
        sampleSize: {
          type: "number",
          description:
            "Sample rows to return alongside the summary. 0 (default) = stats only.",
        },
        sampleField: {
          type: "string",
          description:
            "When sampling, which empty field to filter by: 'merchant', 'categoryId', 'targetAccountId' (unmatched transfers), or 'any' (default).",
        },
      },
    },
  },
  {
    name: "enrich_update",
    description:
      "Bulk SET ... WHERE: set field(s) on all rows matching a condition. Only fills empty fields. Returns per-field counts of what was set vs skipped.",
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
