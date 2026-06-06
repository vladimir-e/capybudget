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
  search_transactions: "Searching transactions",
  group_transactions: "Grouping transactions",
  create_transaction: "Creating transaction",
  update_transaction: "Updating transaction",
  delete_transactions: "Deleting transactions",
  create_account: "Creating account",
  update_account: "Updating account",
  delete_account: "Deleting account",
  create_category: "Creating category",
  update_category: "Updating category",
  delete_category: "Deleting category",
  bulk_update_transactions: "Updating transactions",
  render_chart: "Rendering chart",
  // Import-phase tools (run + MCP)
  analyze_csv: "Analyzing file",
  preview_transform: "Previewing transform",
  transform_csv: "Transforming rows",
  write_import_file: "Writing import file",
  read_import_file: "Reading import file",
  list_import_files: "Listing import files",
  auto_enrich: "Auto-enriching",
  enrich_status: "Checking progress",
  enrich_update: "Enriching transactions",
  apply_account_aliases: "Applying account aliases",
  find_duplicates: "Finding duplicates",
  mark_duplicates: "Marking duplicates",
  auto_mark_duplicates: "Marking duplicates",
  report_status: "Reporting status",
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}
