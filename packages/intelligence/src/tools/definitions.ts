/**
 * Single source of truth for tool descriptors that the model sees —
 * data, mutation, import, csv, read_file, and render tools all live
 * here. Both the MCP server and the in-process API adapters consume
 * these.
 */

// ── Data tool schemas ────────────────────────────────────────────

export const DATA_TOOL_DEFS = [
  {
    name: "list_accounts",
    description:
      "List all accounts with their current balances. Returns account name, type, balance, and whether it's archived.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_transactions",
    description:
      "List transactions with optional filters. Amounts are in cents (negative = expense). Dates are ISO strings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        accountId: {
          type: "string",
          description: "Filter by account ID",
        },
        categoryId: {
          type: "string",
          description: "Filter by category ID",
        },
        merchant: {
          type: "string",
          description: "Filter by merchant name (case-insensitive substring match)",
        },
        startDate: {
          type: "string",
          description: "Filter transactions on or after this date (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Filter transactions on or before this date (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "Maximum number of transactions to return (default: 50)",
        },
      },
    },
  },
  {
    name: "list_categories",
    description:
      "List all categories grouped by type (Income, Fixed, Daily Living, Personal, Irregular).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "spending_summary",
    description:
      "Get spending aggregated by category for a date range. Returns category name, transaction count, and total amount.",
    inputSchema: {
      type: "object" as const,
      properties: {
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD). Defaults to first day of current month.",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Defaults to today.",
        },
      },
    },
  },
  {
    name: "search_merchants",
    description:
      "Search for merchants in the budget's transaction history. Searches both merchant names and raw transaction notes/descriptions. Returns matching merchants with their most recent category and match quality (full, word, fuzzy). Use this to identify merchants from import descriptions — try multiple query chunks for cryptic descriptions (e.g. for 'RBHOOD HGSTS LLC' try 'RBHOOD' and 'HOOD').",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query — a merchant name, abbreviation, or chunk from a bank description. Case-insensitive.",
        },
        limit: {
          type: "number",
          description: "Maximum merchant results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },
] as const

// ── Mutation tool schemas ────────────────────────────────────────

export const MUTATION_TOOL_DEFS = [
  // ── Transactions ────────────────────────────────────────────────
  {
    name: "create_transaction",
    description:
      "Create a new transaction. Amount is always positive cents — sign is determined by type. For transfers, provide toAccountId.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["income", "expense", "transfer"],
          description: "Transaction type",
        },
        amount: {
          type: "integer",
          minimum: 0,
          description: "Amount in positive cents (e.g. 1250 = $12.50)",
        },
        accountId: {
          type: "string",
          description: "Account ID (source account for transfers)",
        },
        categoryId: {
          type: "string",
          description: "Category ID (ignored for transfers)",
        },
        toAccountId: {
          type: "string",
          description: "Destination account ID (required for transfers)",
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format",
        },
        merchant: {
          type: "string",
          description: "Merchant name (ignored for transfers)",
        },
        note: {
          type: "string",
          description: "Optional note",
        },
      },
      required: ["type", "amount", "accountId", "date"],
    },
  },
  {
    name: "update_transaction",
    description:
      "Update an existing transaction. Only provided fields are changed. Amount is always positive cents. For transfers, both legs are updated together.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Transaction ID to update",
        },
        type: {
          type: "string",
          enum: ["income", "expense", "transfer"],
          description: "New transaction type",
        },
        amount: {
          type: "integer",
          minimum: 0,
          description: "New amount in positive cents",
        },
        accountId: {
          type: "string",
          description: "New account ID (source for transfers)",
        },
        categoryId: {
          type: "string",
          description: "New category ID",
        },
        toAccountId: {
          type: "string",
          description: "New destination account (for transfers)",
        },
        date: {
          type: "string",
          description: "New date in YYYY-MM-DD format",
        },
        merchant: {
          type: "string",
          description: "New merchant name",
        },
        note: {
          type: "string",
          description: "New note",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_transactions",
    description:
      "Delete one or more transactions by ID. Transfer pairs are automatically removed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Transaction IDs to delete",
        },
      },
      required: ["ids"],
    },
  },

  // ── Accounts ────────────────────────────────────────────────────
  {
    name: "create_account",
    description:
      "Create a new account. Optionally set an opening balance (positive cents).",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Account name",
        },
        type: {
          type: "string",
          enum: ["cash", "checking", "savings", "credit_card", "loan", "asset", "crypto"],
          description: "Account type",
        },
        openingBalance: {
          type: "integer",
          minimum: 0,
          description: "Opening balance in positive cents (optional)",
        },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "update_account",
    description: "Update an account's name or type.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to update",
        },
        name: {
          type: "string",
          description: "New account name",
        },
        type: {
          type: "string",
          enum: ["cash", "checking", "savings", "credit_card", "loan", "asset", "crypto"],
          description: "New account type",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_account",
    description:
      "Delete an account. Fails if the account has transactions (other than opening balance).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_account",
    description:
      "Archive an account. Fails if the balance is not zero.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to archive",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "unarchive_account",
    description:
      "Unarchive an account so it reappears in the sidebar and net-worth calculations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Account ID to unarchive",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "set_net_worth_exclusions",
    description:
      "Toggle whether one or more accounts are excluded from Net Worth. `exclude: true` excludes them; `exclude: false` includes them. Archived accounts are skipped (the flag is meaningless until they're unarchived).",
    inputSchema: {
      type: "object" as const,
      properties: {
        accountIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Account IDs to update",
        },
        exclude: {
          type: "boolean",
          description: "true = exclude from Net Worth, false = include",
        },
      },
      required: ["accountIds", "exclude"],
    },
  },

  // ── Categories ──────────────────────────────────────────────────
  {
    name: "create_category",
    description: "Create a new category in a group.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Category name",
        },
        group: {
          type: "string",
          enum: ["Income", "Fixed", "Daily Living", "Personal", "Irregular"],
          description: "Category group",
        },
      },
      required: ["name", "group"],
    },
  },
  {
    name: "update_category",
    description: "Update a category's name or group.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to update",
        },
        name: {
          type: "string",
          description: "New category name",
        },
        group: {
          type: "string",
          enum: ["Income", "Fixed", "Daily Living", "Personal", "Irregular"],
          description: "New category group",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_category",
    description:
      "Delete a category. Transactions referencing it will have their category cleared.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "archive_category",
    description: "Archive a category so it's hidden from the UI.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to archive",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "unarchive_category",
    description: "Unarchive a category so it reappears in the UI.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Category ID to unarchive",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "set_category_budget",
    description:
      "Set the monthly budget target for a category. `assigned` is in integer cents (e.g. 20000 = $200/month). Pass `null` to mark the category as untracked. `0` is a distinct, valid value (tracked at zero).",
    inputSchema: {
      type: "object" as const,
      properties: {
        categoryId: {
          type: "string",
          description: "Category ID",
        },
        assigned: {
          type: ["integer", "null"],
          description:
            "Monthly target in cents. null = untracked. 0 = tracked at zero.",
        },
      },
      required: ["categoryId", "assigned"],
    },
  },

  // ── Bulk ────────────────────────────────────────────────────────
  {
    name: "assign_categories",
    description:
      "Assign a category to multiple transactions at once. Skips transfers.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transactionIds: {
          type: "array",
          items: { type: "string" },
          description: "Transaction IDs to update",
        },
        categoryId: {
          type: "string",
          description: "Category ID to assign",
        },
      },
      required: ["transactionIds", "categoryId"],
    },
  },
  {
    name: "bulk_update_transactions",
    description:
      "Apply account, date, and/or merchant changes to many transactions in one call. At least one field in `set` is required. Transfers are skipped for account and merchant changes (transfers move money — they have no merchant, and an account move would orphan the pair). Date changes apply to whatever IDs are passed; if you want both legs of a transfer to shift, include both IDs.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transactionIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Transaction IDs to update",
        },
        set: {
          type: "object",
          description:
            "Fields to change. At least one of accountId, date, merchant must be present.",
          properties: {
            accountId: {
              type: "string",
              description: "New account ID. Validated against existing accounts.",
            },
            date: {
              type: "string",
              description:
                "New date in YYYY-MM-DD format. The existing time-of-day is preserved on each transaction.",
            },
            merchant: {
              type: "string",
              description: "New merchant name.",
            },
          },
        },
      },
      required: ["transactionIds", "set"],
    },
  },
] as const

// ── Import working directory tools ───────────────────────────────
// File I/O scoped to .capy/import/ (the staging area for the import
// flow). Used by both the chat-driven import normalize/enrich sessions
// and external MCP agents (Claude Desktop, Cursor) when they want to
// peek at intermediate state.

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
] as const

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
      "Code-based enrichment: (1) maps sourceCategory → budget categories, (2) matches sourceAccount → budget accounts, (3) resolves transfer target accounts. Leaves merchant empty for the model to fill with cleaned names. Call this FIRST.",
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

// ── Render tool schemas ──────────────────────────────────────────
// These are no-ops on the dispatch side — the frontend intercepts the
// tool_use events and renders the corresponding UI components.

export const RENDER_TOOL_DEFS = [
  {
    name: "render_table",
    description:
      "Render a data table in the UI. Use this instead of markdown tables. The frontend will display it as a styled, interactive table.",
    inputSchema: {
      type: "object" as const,
      properties: {
        headers: {
          type: "array",
          items: { type: "string" },
          description: "Column header labels",
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description:
            "Table rows. Each row is an array of cell strings. Prefix amounts with $ for formatting.",
        },
      },
      required: ["headers", "rows"],
    },
  },
  {
    name: "render_bar_chart",
    description:
      "Render a horizontal bar chart in the UI. Use for comparing values across categories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Chart title" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
          },
          description: "Data points. Values should be positive numbers (dollars, not cents).",
        },
      },
      required: ["title", "data"],
    },
  },
  {
    name: "render_donut_chart",
    description:
      "Render a donut/pie chart in the UI. Use for showing proportions and distributions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Chart title" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
          },
          description: "Data points. Values should be positive numbers (dollars, not cents).",
        },
      },
      required: ["title", "data"],
    },
  },
  {
    name: "render_followups",
    description:
      "Render 2-3 follow-up suggestion chips below the response. Each chip has a short label (button text) and a prompt (sent as the user's next message when clicked). Use for natural follow-up questions or related views.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chips: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "Short button text (3-5 words)",
              },
              prompt: {
                type: "string",
                description:
                  "The full prompt sent as the user's next message when the chip is clicked",
              },
            },
            required: ["label", "prompt"],
          },
          description: "1-4 follow-up chips, ideally 2-3.",
        },
      },
      required: ["chips"],
    },
  },
] as const

// ── Public surface ───────────────────────────────────────────────

export type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: {
    readonly type: "object"
    readonly properties: Readonly<Record<string, unknown>>
    readonly required?: ReadonlyArray<string>
  }
}

/**
 * The merged tool list shipped to the model: data + mutation + import +
 * csv + read_file + render. Returned as a fresh array so callers can
 * safely mutate it.
 *
 * Both chat and import sessions use the same surface. The system prompt
 * (chat vs. import) tells the model which tools are appropriate to
 * reach for — exposing the full set is simpler than switching toolsets
 * per session and matches what MCP-based external agents see.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    ...DATA_TOOL_DEFS,
    ...MUTATION_TOOL_DEFS,
    ...IMPORT_TOOL_DEFS,
    ...CSV_TOOL_DEFS,
    READ_FILE_TOOL_DEF,
    ...RENDER_TOOL_DEFS,
  ]
}

/**
 * Names of mutation tools — the app uses this set to decide when to
 * invalidate cached data after a turn completes.
 */
export const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set(
  MUTATION_TOOL_DEFS.map((t) => t.name),
)
