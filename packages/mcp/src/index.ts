// The MCP server (`./server.ts`) is a thin transport over the intelligence
// tool layer. The package's public surface is just the node fs adapter.
export { nodeFileAdapter } from "./node-file-adapter.js"
