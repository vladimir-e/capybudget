/**
 * Single source of truth for tool descriptors that the model sees —
 * data, mutation, and render tools live here. Both the MCP server
 * and the in-process API adapters consume these.
 *
 * Import + CSV tool descriptors stay in @capybudget/mcp for now; they
 * use node fs directly and are refactored in Phase B.
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
] as const

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
 * The merged tool list shipped to the model: data + mutation + render.
 * Returned as a fresh array so callers can safely concat platform-specific
 * tools (the MCP server adds import + csv tools on top of this).
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [...DATA_TOOL_DEFS, ...MUTATION_TOOL_DEFS, ...RENDER_TOOL_DEFS]
}

/**
 * Names of mutation tools — the app uses this set to decide when to
 * invalidate cached data after a turn completes.
 */
export const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set(
  MUTATION_TOOL_DEFS.map((t) => t.name),
)
