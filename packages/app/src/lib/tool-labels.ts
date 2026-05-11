/**
 * Human-readable labels for tool-activity content blocks.
 *
 * Used by `capy-overlay` and `import-screen` to render `tool-activity`
 * blocks in chat history. Provider-agnostic — every adapter emits the
 * same tool names via `getToolDefinitions()`, so the label table
 * applies uniformly. Unknown tools fall back to their raw name.
 */

const TOOL_LABELS: Record<string, string> = {
  list_accounts: "Querying accounts",
  list_transactions: "Querying transactions",
  list_categories: "Querying categories",
  spending_summary: "Calculating spending",
  create_transaction: "Creating transaction",
  update_transaction: "Updating transaction",
  delete_transactions: "Deleting transactions",
  create_account: "Creating account",
  update_account: "Updating account",
  delete_account: "Deleting account",
  archive_account: "Archiving account",
  unarchive_account: "Unarchiving account",
  set_net_worth_exclusions: "Updating Net Worth filter",
  create_category: "Creating category",
  update_category: "Updating category",
  delete_category: "Deleting category",
  archive_category: "Archiving category",
  unarchive_category: "Unarchiving category",
  set_category_budget: "Setting category budget",
  assign_categories: "Assigning categories",
  bulk_update_transactions: "Updating transactions",
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}
