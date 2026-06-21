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
        toAmount: {
          type: "integer",
          minimum: 0,
          description:
            "Cross-currency transfers only: positive cents received in the destination account's currency, when it differs from the source's. Omit for same-currency transfers; if omitted across currencies, today's rate is used.",
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
        toAmount: {
          type: "integer",
          minimum: 0,
          description:
            "Cross-currency transfers only: positive cents received in the destination account's currency, when it differs from the source's.",
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
        currency: {
          type: "string",
          description:
            "ISO 4217 code for the account's currency (e.g. EUR, RUB). Omit for the budget default. Set it for a foreign account — its balance and flows then roll up into the default currency at the resolved rate.",
        },
      },
      required: ["name", "type"],
    },
  },
  {
    name: "update_account",
    description:
      "Update an account. Only provided fields change. See the `archived` and `excludeFromNetWorth` param docs for their effects.",
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
        archived: {
          type: "boolean",
          description:
            "true archives the account (fails unless balance is zero); false unarchives it.",
        },
        excludeFromNetWorth: {
          type: "boolean",
          description: "true excludes the account from Net Worth; false includes it.",
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
    description:
      "Update a category. Only provided fields change. `archived` toggles visibility; `budgetCents` sets the monthly budget target (see its param doc).",
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
        archived: {
          type: "boolean",
          description: "true archives the category (hidden from the UI); false unarchives it.",
        },
        budgetCents: {
          type: ["integer", "null"],
          description:
            "Monthly budget target in cents. null = untracked. 0 = tracked at zero. Omit to leave unchanged.",
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

  // ── Bulk ────────────────────────────────────────────────────────
  {
    name: "bulk_update_transactions",
    description:
      "Apply category, account, date, and/or merchant changes to many transactions at once. Transfers are skipped for category/account/merchant changes (they have neither, and moving one leg orphans the pair); date changes apply to any ID, so pass both legs to shift a transfer.",
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
            "Fields to change. At least one of categoryId, accountId, date, merchant must be present.",
          properties: {
            categoryId: {
              type: "string",
              description: "New category ID. Validated against existing categories.",
            },
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
