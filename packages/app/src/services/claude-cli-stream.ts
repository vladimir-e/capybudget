/**
 * Claude CLI stream-json decoder — internal to `ClaudeCliSession`.
 *
 * The CLI emits assistant turns as cumulative JSON lines (each event
 * carries ALL content blocks so far). This module reconstructs the
 * full block list and yields a `StreamEvent` per parsed line. Other
 * adapters (Anthropic, OpenAI) emit `StreamEvent`s directly without
 * roundtripping through the CLI's wire format — so this decoder lives
 * here only to bridge the one provider that actually speaks it.
 *
 * Kept in its own file (rather than inlined in `claude-cli-session.ts`)
 * because the parser is non-trivial and benefits from independent
 * testing.
 */

import {
  buildRenderToolMap,
  type ContentBlock,
  type StreamEvent,
} from "@capybudget/intelligence"

// ── Render tool → ContentBlock mapping ───────────────────────────
// Shared with the API adapters via `buildRenderToolMap()` —
// single source of truth for the render-tool → ContentBlock contract.

const RENDER_TOOL_MAP: Record<string, (input: Record<string, unknown>) => ContentBlock | null> =
  buildRenderToolMap()

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
