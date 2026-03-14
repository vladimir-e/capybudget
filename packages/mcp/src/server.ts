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
import { RENDER_TOOLS } from "./render-tools.js"

// ── Budget path ──────────────────────────────────────────────────

const BUDGET_PATH = process.env.BUDGET_PATH
if (!BUDGET_PATH) {
  throw new Error("BUDGET_PATH environment variable is required")
}

// ── Repository ───────────────────────────────────────────────────

const repo = createCsvRepository(BUDGET_PATH, nodeFileAdapter)

// ── Server setup ─────────────────────────────────────────────────

const server = new Server(
  { name: "capy", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...DATA_TOOLS, ...RENDER_TOOLS],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // Render tools are no-ops — the frontend intercepts the tool_use event
  if (name.startsWith("render_")) {
    return { content: [{ type: "text", text: "Rendered." }] }
  }

  try {
    let text: string
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

// ── Start ────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
