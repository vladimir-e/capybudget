/**
 * Claude CLI stream-json decoder — internal to `ClaudeCliSession`.
 * Stateless: each line is parsed into one or more `StreamEvent`s and
 * forwarded with the per-turn `message.id`. Accumulation logic lives
 * in the session (see `accumulateCycleEvent`).
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
      const message = event.message as
        | { id?: string; content?: Array<Record<string, unknown>> }
        | undefined
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
        const messageId = typeof message?.id === "string" ? message.id : undefined
        events.push(
          messageId ? { type: "content", blocks, messageId } : { type: "content", blocks },
        )
      }
      break
    }

    case "result": {
      // Result lines mark the end of a turn. Most are clean completions
      // (`{type: "result"}`); error terminations carry `is_error: true`
      // and an `errors` array — `error_max_turns` is the main one we
      // care about (the CLI's runaway backstop, enabled via `--max-turns`).
      if (event.is_error) {
        const errs = event.errors as string[] | undefined
        const message = errs?.[0] ?? "Session terminated with an error."
        events.push({ type: "error", message })
      } else {
        events.push({ type: "done" })
      }
      break
    }

    case "error":
      events.push({
        type: "error",
        message: (event.error as { message?: string })?.message ?? "Unknown error",
      })
      break
  }

  return events
}
