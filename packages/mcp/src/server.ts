import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { createCsvRepository } from "@capybudget/persistence"
import { nodeFileAdapter } from "./node-file-adapter.js"
import {
  DATA_TOOLS,
  handleListAccounts,
  handleListTransactions,
  handleListCategories,
  handleSpendingSummary,
} from "./data-tools.js"
import {
  MUTATION_TOOLS,
  handleCreateTransaction,
  handleUpdateTransaction,
  handleDeleteTransactions,
  handleCreateAccount,
  handleUpdateAccount,
  handleDeleteAccount,
  handleArchiveAccount,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleArchiveCategory,
  handleAssignCategories,
} from "./mutation-tools.js"
import { RENDER_TOOLS } from "./render-tools.js"

// ── Budget path ──────────────────────────────────────────────────

const BUDGET_PATH = process.env.BUDGET_PATH
if (!BUDGET_PATH) {
  throw new Error("BUDGET_PATH environment variable is required")
}

// ── Repository ───────────────────────────────────────────────────

const repo = createCsvRepository(BUDGET_PATH, nodeFileAdapter, { immediate: true })

// ── Server setup ─────────────────────────────────────────────────

const server = new Server(
  { name: "capy", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...DATA_TOOLS, ...MUTATION_TOOLS, ...RENDER_TOOLS],
}))

// ── Mutation tool dispatch ───────────────────────────────────────

const MUTATION_HANDLERS: Record<
  string,
  (r: typeof repo, args: Record<string, unknown>) => Promise<string>
> = {
  create_transaction: (r, a) => handleCreateTransaction(r, a),
  update_transaction: (r, a) => handleUpdateTransaction(r, a),
  delete_transactions: (r, a) => handleDeleteTransactions(r, a),
  create_account: (r, a) => handleCreateAccount(r, a),
  update_account: (r, a) => handleUpdateAccount(r, a),
  delete_account: (r, a) => handleDeleteAccount(r, a),
  archive_account: (r, a) => handleArchiveAccount(r, a),
  create_category: (r, a) => handleCreateCategory(r, a),
  update_category: (r, a) => handleUpdateCategory(r, a),
  delete_category: (r, a) => handleDeleteCategory(r, a),
  archive_category: (r, a) => handleArchiveCategory(r, a),
  assign_categories: (r, a) => handleAssignCategories(r, a),
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // Render tools are no-ops — the frontend intercepts the tool_use event
  if (name.startsWith("render_")) {
    return { content: [{ type: "text", text: "Rendered." }] }
  }

  try {
    let text: string

    // Check mutation tools first
    const mutationHandler = MUTATION_HANDLERS[name]
    if (mutationHandler) {
      text = await mutationHandler(repo, args ?? {})
      return { content: [{ type: "text", text }] }
    }

    // Data tools
    switch (name) {
      case "list_accounts":
        text = await handleListAccounts(repo)
        break
      case "list_transactions":
        text = await handleListTransactions(repo, args ?? {})
        break
      case "list_categories":
        text = await handleListCategories(repo)
        break
      case "spending_summary":
        text = await handleSpendingSummary(repo, args ?? {})
        break
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }

    return { content: [{ type: "text", text }] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    }
  }
})

// ── Graceful shutdown ────────────────────────────────────────────

async function shutdown() {
  await repo.dispose()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// ── Start ────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
