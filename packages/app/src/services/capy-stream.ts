/**
 * Parses Claude CLI stream-json stdout lines into typed events.
 *
 * Claude's assistant messages contain cumulative content blocks:
 * - text blocks: full text so far (replace, don't append)
 * - tool_use blocks: MCP tool calls with structured input
 *
 * Render tools (render_table, render_bar_chart, render_donut_chart) carry
 * structured data for the UI. Data tools show activity indicators.
 */

import type {
  ContentBlock,
  BarChartBlock,
  DonutChartBlock,
  StreamEvent,
  TableBlock,
} from "@capybudget/intelligence"

export type { StreamEvent }

// ── Render tool → ContentBlock mapping ───────────────────────────

const RENDER_TOOL_MAP: Record<string, (input: Record<string, unknown>) => ContentBlock | null> = {
  render_table: (input) => {
    if (!Array.isArray(input.headers) || !Array.isArray(input.rows)) return null
    return { type: "table", headers: input.headers, rows: input.rows } satisfies TableBlock
  },

  render_bar_chart: (input) => {
    if (typeof input.title !== "string" || !Array.isArray(input.data)) return null
    return { type: "bar-chart", title: input.title, data: input.data } satisfies BarChartBlock
  },

  render_donut_chart: (input) => {
    if (typeof input.title !== "string" || !Array.isArray(input.data)) return null
    return { type: "donut-chart", title: input.title, data: input.data } satisfies DonutChartBlock
  },
}

// ── Parser ───────────────────────────────────────────────────────

/**
 * Parse a single stdout JSON line from the Claude CLI.
 * Returns an array of StreamEvents (one line can produce multiple events).
 */
export function parseStreamLine(line: string): StreamEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let event: Record<string, unknown>
  try {
    event = JSON.parse(trimmed)
  } catch {
    return []
  }

  const events: StreamEvent[] = []

  switch (event.type) {
    case "assistant": {
      const message = event.message as { content?: Array<Record<string, unknown>> } | undefined
      const blocks = message?.content ?? []

      for (const block of blocks) {
        if (block.type === "text") {
          events.push({ type: "text", text: block.text as string })
        } else if (block.type === "tool_use") {
          // MCP tools are prefixed as "mcp__<server>__<tool>" — strip to base name
          const rawName = block.name as string
          const baseName = rawName.replace(/^mcp__\w+__/, "")
          const input = block.input as Record<string, unknown>

          const renderFn = RENDER_TOOL_MAP[baseName]
          if (renderFn) {
            const rendered = renderFn(input)
            if (rendered) events.push({ type: "render", block: rendered })
          } else {
            events.push({ type: "tool-activity", tool: baseName })
          }
        }
      }
      break
    }

    case "result":
      events.push({ type: "done" })
      break

    case "error":
      events.push({
        type: "error",
        message: (event.error as { message?: string })?.message ?? "Unknown error",
      })
      break
  }

  return events
}
