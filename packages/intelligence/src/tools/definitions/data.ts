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
        format: {
          type: "string",
          enum: ["compact", "full"],
          description:
            "Row shape. Default 'full' resolves account/category names and adds a formatted amount string. 'compact' drops resolution for a lean row ({id, date, amountCents (signed), type, accountId, categoryId, merchant, note, transferPairId}) — packs more rows per token; resolve names via list_accounts/list_categories when needed.",
        },
      },
    },
  },
  {
    name: "search_transactions",
    description:
      "Fuzzy-search transactions by free text and/or structured filters, returning compact rows. `query` matches case-insensitively across merchant, note (raw bank description), category name, account name, and money formats ($1,850.00 / 1850 / partial 29→$1.29 or $290) — the same search as the app's transaction list. Use it to find a set ('all my Apple charges', 'anything around $29'). Each row is {id, date, amountCents (signed: negative = outflow), type, accountId, categoryId, merchant, note, transferPairId}; resolve names via list_accounts/list_categories when needed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Free-text query matched across merchant, note, category name, account name, and money formats. Optional — omit to filter purely by the structured fields below.",
        },
        accountId: { type: "string", description: "Filter by account ID" },
        categoryId: { type: "string", description: "Filter by category ID" },
        type: {
          type: "string",
          enum: ["income", "expense", "transfer"],
          description: "Filter by transaction type",
        },
        startDate: {
          type: "string",
          description: "Filter transactions on or after this date (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Filter transactions on or before this date (YYYY-MM-DD)",
        },
        minAmountCents: {
          type: "number",
          description:
            "Filter to transactions with signed amount >= this (cents). Note amounts are signed: -5000 is a $50 outflow.",
        },
        maxAmountCents: {
          type: "number",
          description:
            "Filter to transactions with signed amount <= this (cents).",
        },
        sort: {
          type: "string",
          enum: ["newest", "oldest", "amount_asc", "amount_desc"],
          description:
            "Sort order. Default 'newest'. 'amount_asc' is most-negative-first (biggest expenses); 'amount_desc' is most-positive-first (biggest income).",
        },
        limit: {
          type: "number",
          description: "Maximum rows to return (default: 50)",
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
    name: "search_merchants",
    description:
      "Search the budget's transaction history (merchant names + raw descriptions) for a merchant. Returns matches with their most recent category and match quality (full, word, fuzzy). For cryptic bank descriptions, try multiple query chunks (e.g. for 'RBHOOD HGSTS LLC' try 'RBHOOD' and 'HOOD').",
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
