/**
 * Parses Claude CLI stream-json stdout lines into typed events.
 *
 * Claude's assistant messages are cumulative — each event contains ALL content
 * blocks so far. We reconstruct the full block list and emit a single "content"
 * event, preserving all text blocks (before/after tool calls) and recording
 * tool activity as persistent blocks in chat history.
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

// ── Tool name labels for display ─────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  list_accounts: "Querying accounts",
  list_transactions: "Querying transactions",
  list_categories: "Querying categories",
  spending_summary: "Calculating spending",
  create_transaction: "Creating transaction",
  update_transaction: "Updating transaction",
  delete_transactions: "Deleting transactions",
  create_account: "Creating account",
  update_account: "Updating account",
  delete_account: "Deleting account",
  archive_account: "Archiving account",
  create_category: "Creating category",
  update_category: "Updating category",
  delete_category: "Deleting category",
  archive_category: "Archiving category",
  assign_categories: "Assigning categories",
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}

// ── Parser ───────────────────────────────────────────────────────

/**
 * Parse a single stdout JSON line from the Claude CLI.
 * Returns an array of StreamEvents (typically one per line).
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
      const rawBlocks = message?.content ?? []
      const blocks: ContentBlock[] = []

      for (const block of rawBlocks) {
        if (block.type === "text") {
          blocks.push({ type: "text", content: block.text as string })
        } else if (block.type === "tool_use") {
          const rawName = block.name as string
          const baseName = rawName.replace(/^mcp__\w+__/, "")
          const input = block.input as Record<string, unknown>

          const renderFn = RENDER_TOOL_MAP[baseName]
          if (renderFn) {
            const rendered = renderFn(input)
            if (rendered) blocks.push(rendered)
          } else {
            blocks.push({ type: "tool-activity", tool: baseName })
          }
        }
      }

      if (blocks.length > 0) {
        events.push({ type: "content", blocks })
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
