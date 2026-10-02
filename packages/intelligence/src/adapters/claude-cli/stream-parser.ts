import { extractErrorMessage, isRateLimited } from "../../error-message"
import { endingEvent, type Ending } from "../agent-turn"
import type { StreamEvent } from "../../types"

export type CliPart =
  | { type: "text"; text: string }
  | { type: "call"; id: string; name: string; input: Record<string, unknown> }

export type CliEvent =
  | { type: "message"; id?: string; parts: CliPart[] }
  | { type: "tool-result"; id: string; ok: boolean }
  | { type: "end"; event: StreamEvent }
  | { type: "result"; event: StreamEvent }

type ErrorEvent = Extract<StreamEvent, { type: "error" }>

const FALLBACK_ERROR = "Claude Code ended the reply with an error."
const API_ERROR = /^API Error: (\d{3}) (\{[\s\S]*\})\s*$/
const MCP_PREFIX = /^mcp__\w+__/

export function parseStreamLine(line: string): CliEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let event: Record<string, unknown>
  try {
    event = JSON.parse(trimmed)
  } catch {
    return []
  }
  switch (event.type) {
    case "assistant":
      return parseAssistant(event)
    case "user":
      return parseToolResults(event)
    case "result":
      return [{ type: "result", event: parseResult(event) }]
    case "error": {
      const message = (event.error as { message?: unknown } | undefined)?.message
      return [{ type: "result", event: failureEvent(typeof message === "string" ? message : "") }]
    }
    default:
      return []
  }
}

interface AssistantMessage {
  id?: unknown
  content?: Array<Record<string, unknown>>
  stop_reason?: unknown
}

function parseAssistant(event: Record<string, unknown>): CliEvent[] {
  const message = (event.message ?? {}) as AssistantMessage
  const content = message.content ?? []
  if (typeof event.error === "string") {
    return [{ type: "end", event: assistantErrorEvent(event.error, textOf(content)) }]
  }

  const parts: CliPart[] = []
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      parts.push({ type: "text", text: block.text })
    } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      parts.push({
        type: "call",
        id: block.id,
        name: block.name.replace(MCP_PREFIX, ""),
        input: (block.input ?? {}) as Record<string, unknown>,
      })
    }
  }

  const events: CliEvent[] = []
  if (parts.length > 0) {
    events.push(typeof message.id === "string" ? { type: "message", id: message.id, parts } : { type: "message", parts })
  }
  if (typeof message.stop_reason === "string" && message.stop_reason !== "tool_use") {
    events.push({ type: "end", event: endingEvent(stopEnding(message.stop_reason)) })
  }
  return events
}

function parseToolResults(event: Record<string, unknown>): CliEvent[] {
  const content = (event.message as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? []
  return content.flatMap((block): CliEvent[] =>
    block.type === "tool_result" && typeof block.tool_use_id === "string"
      ? [{ type: "tool-result", id: block.tool_use_id, ok: block.is_error !== true }]
      : [],
  )
}

function parseResult(event: Record<string, unknown>): StreamEvent {
  if (event.subtype === "error_max_turns") return endingEvent("budgetExhausted")
  if (event.is_error === true) {
    const text = typeof event.result === "string" && event.result.trim() ? event.result : firstError(event.errors)
    return failureEvent(text, typeof event.api_error_status === "number" ? event.api_error_status : undefined)
  }
  return endingEvent(typeof event.stop_reason === "string" ? stopEnding(event.stop_reason) : "done")
}

function stopEnding(stopReason: string): Ending {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
      return "done"
    case "refusal":
      return "refused"
    default:
      return "cutOff"
  }
}

function assistantErrorEvent(kind: string, text: string): StreamEvent {
  if (kind === "max_output_tokens") return endingEvent("cutOff")
  const event = failureEvent(text)
  return kind === "rate_limit" ? { ...event, code: "rateLimited" } : event
}

function failureEvent(text: string, status?: number): ErrorEvent {
  const err = apiError(text || FALLBACK_ERROR, status)
  const { message, status: parsedStatus } = extractErrorMessage(err)
  return {
    type: "error",
    message,
    ...(parsedStatus !== undefined ? { status: parsedStatus } : {}),
    ...(isRateLimited(err) ? { code: "rateLimited" as const } : {}),
  }
}

function apiError(text: string, status?: number): Error {
  const match = API_ERROR.exec(text.trim())
  return Object.assign(new Error(text), match ? { status: Number(match[1]), error: parseJson(match[2]) } : { status })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function textOf(content: Array<Record<string, unknown>>): string {
  return content
    .flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("\n")
    .trim()
}

function firstError(errors: unknown): string {
  return Array.isArray(errors) && typeof errors[0] === "string" ? errors[0] : ""
}
