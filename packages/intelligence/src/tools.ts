/**
 * Tool name constants shared between the MCP server (which implements them)
 * and the app (which detects them in the stream for cache invalidation).
 */

export const MUTATION_TOOL_NAMES = new Set([
  "create_transaction",
  "update_transaction",
  "delete_transactions",
  "create_account",
  "update_account",
  "delete_account",
  "archive_account",
  "create_category",
  "update_category",
  "delete_category",
  "archive_category",
  "assign_categories",
])
