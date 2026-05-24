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
 *
 * Returns an array of StreamEvents (typically one per line).
 *
 * The optional `toolUseRegistry` map is read+written across lines: when
 * the parser sees a `tool_use` block in an `assistant` event it records
 * `id → name`; when it later sees a matching `tool_result` in a `user`
 * event it looks the name back up so the emitted `tool-result` event
 * carries the tool name. Callers own the map's lifetime (the session
 * resets it on each user→done cycle).
 */
export function parseStreamLine(
  line: string,
  toolUseRegistry?: Map<string, string>,
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
          blocks.push({ type: "text", content: block.text as string })
        } else if (block.type === "tool_use") {
          const rawName = block.name as string
          const baseName = rawName.replace(/^mcp__\w+__/, "")
          const input = block.input as Record<string, unknown>
          const toolUseId = block.id as string | undefined
          if (toolUseRegistry && toolUseId) {
            toolUseRegistry.set(toolUseId, baseName)
          }

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

      // The CLI emits a terminal `result` line some time after the
      // final assistant turn — gating the UI on it costs us seconds of
      // waiting on the subprocess's stream drain. Treat any
      // non-tool-use `stop_reason` on the assistant turn as the real
      // "done" signal; the later `result` line stays bookkeeping.
      const stopReason = message?.stop_reason
      if (stopReason && stopReason !== "tool_use") {
        events.push({ type: "done" })
      }
      break
    }

    case "user": {
      // The CLI wraps MCP tool results inside a `user` message whose
      // content array carries one or more `tool_result` blocks. The
      // model also sees this — for the consumer we only need the
      // completion signal (per-call cache invalidation in the hook).
      // The result block carries the `tool_use_id` but not the name;
      // we look the name up in the registry populated when we parsed
      // the matching assistant turn.
      const message = event.message as
        | { content?: Array<Record<string, unknown>> }
        | undefined
      const rawBlocks = message?.content ?? []
      for (const block of rawBlocks) {
        if (block.type !== "tool_result") continue
        const toolUseId = block.tool_use_id as string | undefined
        if (!toolUseId) continue
        const name = toolUseRegistry?.get(toolUseId)
        if (!name) continue // unknown id (registry not provided or mismatched) — skip
        const ok = block.is_error !== true
        events.push({ type: "tool-result", tool: name, id: toolUseId, ok })
      }
      break
    }

    case "result": {
      // Result lines are the CLI's "subprocess done" bookkeeping —
      // they arrive after the model's last chunk plus the SSE/stream
      // drain. The success path's `done` is already fired off the
      // final assistant turn's `stop_reason`; here we only care about
      // error terminations (`is_error: true` with an `errors` array —
      // `error_max_turns` is the main one, from the `--max-turns`
      // runaway backstop).
      if (event.is_error) {
        const errs = event.errors as string[] | undefined
        const message = errs?.[0] ?? "Session terminated with an error."
        events.push({ type: "error", message })
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
