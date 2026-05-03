// All tool definitions and handlers now live in @capybudget/intelligence.
// The MCP server (`./server.ts`) is a thin transport that wires
// `getToolDefinitions()` to ListTools and `runTool()` to CallTool.
// Public surface: just the node fs adapter, kept here so the package
// stays self-describing.
export { nodeFileAdapter } from "./node-file-adapter.js"
