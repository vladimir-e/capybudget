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
      "List transactions with optional filters, sort, and pagination. Amounts are in cents (negative = expense). Dates are ISO strings. Combine `sort: \"oldest\"` with `limit: 1` to fetch the very first transaction in one call.",
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
        sort: {
          type: "string",
          enum: ["newest", "oldest", "amount_asc", "amount_desc"],
          description:
            "Sort order. Default 'newest' (most recent first). 'amount_asc' is most-negative-first (biggest expenses); 'amount_desc' is most-positive-first (biggest income).",
        },
        limit: {
          type: "number",
          description: "Maximum number of transactions to return (default: 50)",
        },
        offset: {
          type: "number",
          description:
            "Number of transactions to skip before returning results (default: 0). Use with `limit` to paginate.",
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
  {
    name: "transaction_bounds",
    description:
      "Return the count and date range (min/max) of transactions, with the same optional filters as `list_transactions`. Use this to answer 'when did I start tracking?', 'how long is my history?', or 'what's the date range of my data?' in one call instead of probing. Combine with `startDate`/`endDate` to scope to a window (e.g. 'when did I first shop at Whole Foods in 2025').",
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
      },
    },
  },
] as const
