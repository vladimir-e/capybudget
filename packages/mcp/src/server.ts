import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { createCsvRepository } from "@capybudget/persistence"
import {
  getToolDefinitions,
  isDispatchTool,
  runTool,
  type ToolContext,
} from "@capybudget/intelligence"
import { nodeFileAdapter } from "./node-file-adapter.js"
import {
  IMPORT_TOOLS,
  handleReadImportFile,
  handleWriteImportFile,
  handleAppendImportFile,
  handleListImportFiles,
} from "./import-tools.js"
import {
  CSV_TOOLS,
  handleAnalyzeCsv,
  handlePreviewTransform,
  handleTransformCsv,
  handleAutoEnrich,
  handleEnrichStats,
  handleEnrichSample,
  handleEnrichUpdate,
} from "./csv-tools.js"

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
  // Data + mutation + render come from intelligence; import + csv are
  // still owned by mcp until Phase B refactors them to FileAdapter.
  tools: [...getToolDefinitions(), ...IMPORT_TOOLS, ...CSV_TOOLS],
}))

// ── Import tool dispatch (mcp-local, node fs) ────────────────────

const IMPORT_HANDLERS: Record<
  string,
  (budgetPath: string, args: Record<string, unknown>) => Promise<string>
> = {
  read_import_file: (p, a) => handleReadImportFile(p, a),
  write_import_file: (p, a) => handleWriteImportFile(p, a),
  append_import_file: (p, a) => handleAppendImportFile(p, a),
  list_import_files: (p) => handleListImportFiles(p),
  analyze_csv: (p, a) => handleAnalyzeCsv(p, a),
  preview_transform: (p, a) => handlePreviewTransform(p, a),
  transform_csv: (p, a) => handleTransformCsv(p, a),
  enrich_stats: (p) => handleEnrichStats(p),
  enrich_sample: (p, a) => handleEnrichSample(p, a),
  enrich_update: (p, a) => handleEnrichUpdate(p, a),
  auto_enrich: (p) => handleAutoEnrich(p, repo),
}

// ── Tool dispatch ────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    // Data + mutation + render tools all run through the shared dispatch.
    if (isDispatchTool(name)) {
      const text = await runTool(name, args ?? {}, dispatchCtx)
      return { content: [{ type: "text", text }] }
    }

    // Import + csv tools stay local to mcp until Phase B.
    const importHandler = IMPORT_HANDLERS[name]
    if (importHandler) {
      const text = await importHandler(BUDGET_PATH, args ?? {})
      return { content: [{ type: "text", text }] }
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    }
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
