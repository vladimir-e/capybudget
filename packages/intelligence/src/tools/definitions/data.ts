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
        ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Fetch exactly these transaction IDs (in order), ignoring all other filters/sort/pagination. The drill companion to a compact scan or group_transactions result. Pairs well with format:'compact'.",
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
    name: "group_transactions",
    description:
      "Aggregate transactions into groups and compute metrics per group — the universal rollup. Same filters as search_transactions (query/account/category/type/date/amount), then group by one or more dimensions and request metrics. All money is SIGNED cents: spending groups sum negative. Covers spending-by-category, merchant rollups, day-of-month histograms, amount+date duplicate clusters (groupBy:[amountBucket,month]), distinct counts, and recurrence (the `cadence` metric: median/min/max day-gap between a group's sorted occurrences). Each group returns its key(s) (resolved label + raw id for merchant/category/account) plus the requested metrics.",
    inputSchema: {
      type: "object" as const,
      properties: {
        groupBy: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "merchant",
              "category",
              "account",
              "type",
              "month",
              "week",
              "dayOfMonth",
              "amountBucket",
            ],
          },
          description:
            "Dimensions to group by, in key order. Multi-key supported, e.g. [merchant, dayOfMonth] or [amountBucket, month]. month=YYYY-MM, week=ISO YYYY-Www, dayOfMonth=1–31.",
        },
        metrics: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "count",
              "sum",
              "avg",
              "min",
              "max",
              "median",
              "distinctMerchants",
              "distinctAccounts",
              "distinctCategories",
              "distinctAmounts",
              "cadence",
            ],
          },
          description:
            "Metrics per group (over signed amount cents). `cadence` is heavier — request only for recurrence questions; it returns {occurrences, medianGapDays, minGapDays, maxGapDays, madGapDays} (gaps null for a single occurrence).",
        },
        amountBucketCents: {
          type: "number",
          description:
            "Bucket size in cents for the amountBucket dimension. Omit for exact-amount grouping (the duplicate-detection case).",
        },
        query: {
          type: "string",
          description:
            "Free-text scope matched across merchant, note, category/account name, and money formats (same as search_transactions). Optional.",
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
          description: "Filter to transactions on or after this date (YYYY-MM-DD)",
        },
        endDate: {
          type: "string",
          description: "Filter to transactions on or before this date (YYYY-MM-DD)",
        },
        minAmountCents: {
          type: "number",
          description: "Filter to signed amount >= this (cents)",
        },
        maxAmountCents: {
          type: "number",
          description: "Filter to signed amount <= this (cents)",
        },
        sortByMetric: {
          type: "string",
          description:
            "Sort groups by this requested metric (cadence not sortable). Omit to leave unordered.",
        },
        sortDir: {
          type: "string",
          enum: ["asc", "desc"],
          description: "Sort direction (default desc).",
        },
        limit: {
          type: "number",
          description: "Keep only the top-N groups after sorting.",
        },
      },
      required: ["groupBy", "metrics"],
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
