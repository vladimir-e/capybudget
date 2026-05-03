import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { createCsvRepository } from "@capybudget/persistence"
import {
  getToolDefinitions,
  runTool,
  type ToolContext,
} from "@capybudget/intelligence"
import { nodeFileAdapter } from "./node-file-adapter.js"

// ── Budget path ──────────────────────────────────────────────────

const BUDGET_PATH = process.env.BUDGET_PATH
if (!BUDGET_PATH) {
  throw new Error("BUDGET_PATH environment variable is required")
}

// ── Repository + dispatch context ────────────────────────────────

const repo = createCsvRepository(BUDGET_PATH, nodeFileAdapter, { immediate: true })

const dispatchCtx: ToolContext = {
  repo,
  fileAdapter: nodeFileAdapter,
  budgetPath: BUDGET_PATH,
}

// ── Server setup ─────────────────────────────────────────────────

const server = new Server(
  { name: "capy", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  // Single source of truth — `getToolDefinitions()` returns the full
  // tool surface (data, mutation, import, csv, read_file, render).
  // External agents (Claude Desktop, Cursor) see the same tools the
  // app's API adapters dispatch in-process.
  tools: getToolDefinitions(),
}))

// ── Tool dispatch ────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    const text = await runTool(name, args ?? {}, dispatchCtx)
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
  try {
    await repo.dispose()
  } catch (err) {
    console.error("Error during shutdown:", err)
    process.exit(1)
  }
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// ── Start ────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
