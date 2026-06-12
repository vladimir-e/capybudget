import {
  buildRenderToolMap,
  type ContentBlock,
  type StreamEvent,
} from "@capybudget/intelligence"

const RENDER_TOOL_MAP: Record<string, (input: Record<string, unknown>) => ContentBlock | null> =
  buildRenderToolMap()

export interface CycleState {
  doneEmitted: boolean
}

export function parseStreamLine(
  line: string,
  toolUseRegistry?: Map<string, string>,
  cycleState?: CycleState,
): StreamEvent[] {
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
        | {
            id?: string
            content?: Array<Record<string, unknown>>
            stop_reason?: string
          }
        | undefined
      const rawBlocks = message?.content ?? []
      const blocks: ContentBlock[] = []

      for (const block of rawBlocks) {
        if (block.type === "text") {
          // CLI post-tool ack sometimes surfaces as a blank assistant message; skip it.
          const text = block.text as string
          if (text.trim().length === 0) continue
          blocks.push({ type: "text", content: text })
        } else if (block.type === "tool_use") {
          const rawName = block.name as string
          const baseName = rawName.replace(/^mcp__\w+__/, "")
          const input = block.input as Record<string, unknown>
          const toolUseId = block.id as string | undefined
          if (toolUseRegistry && toolUseId) {
            toolUseRegistry.set(toolUseId, baseName)
          }

          const rendered = RENDER_TOOL_MAP[baseName]?.(input) ?? null
          blocks.push(rendered ?? { type: "tool-activity", tool: baseName })
        }
      }

      if (blocks.length > 0) {
        const messageId = typeof message?.id === "string" ? message.id : undefined
        events.push(
          messageId ? { type: "content", blocks, messageId } : { type: "content", blocks },
        )
      }

      // Treat the assistant turn's terminal stop_reason as `done`; the trailing
      // `result` line would add seconds of subprocess-drain latency.
      const stopReason = message?.stop_reason
      if (stopReason && stopReason !== "tool_use") {
        events.push({ type: "done" })
        if (cycleState) cycleState.doneEmitted = true
      }
      break
    }

    case "user": {
      const message = event.message as
        | { content?: Array<Record<string, unknown>> }
        | undefined
      const rawBlocks = message?.content ?? []
      for (const block of rawBlocks) {
        if (block.type !== "tool_result") continue
        const toolUseId = block.tool_use_id as string | undefined
        if (!toolUseId) continue
        const name = toolUseRegistry?.get(toolUseId)
        if (!name) continue
        const ok = block.is_error !== true
        events.push({ type: "tool-result", tool: name, id: toolUseId, ok })
      }
      break
    }

    case "result": {
      if (event.is_error) {
        const errs = event.errors as string[] | undefined
        const message = errs?.[0] ?? "Session terminated with an error."
        events.push({ type: "error", message })
      } else if (cycleState && !cycleState.doneEmitted) {
        // Fallback when no terminal `stop_reason` arrived (mid-stream
        // truncation, future CLI versions) — keeps the UI from hanging.
        events.push({ type: "done" })
        cycleState.doneEmitted = true
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
