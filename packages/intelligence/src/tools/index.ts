export { MUTATION_TOOL_NAMES, START_IMPORT_TOOL_NAME, getToolDefinitions } from "./definitions"
export type { ToolDefinition } from "./definitions"

export { runTool } from "./dispatch"
export type { ToolContext } from "./dispatch"

/**
 * Cap on the tool calls one reply may dispatch — a runaway-loop backstop,
 * reset on every send. A well-formed answer converges in a handful of calls.
 */
export const REPLY_TOOL_CALL_BUDGET = 100
