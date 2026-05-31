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
