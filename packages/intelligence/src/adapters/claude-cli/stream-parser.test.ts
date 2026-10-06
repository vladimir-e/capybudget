import { describe, it, expect } from "vitest"
import { endingEvent } from "../agent-turn"
import { parseStreamLine } from "./stream-parser"

function line(event: Record<string, unknown>): string {
  return JSON.stringify(event)
}

function assistant(message: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return line({ type: "assistant", message, ...extra })
}

describe("parseStreamLine", () => {
  describe("noise", () => {
    it("ignores blank lines, invalid JSON, and unknown event types", () => {
      expect(parseStreamLine("")).toEqual([])
      expect(parseStreamLine("   \t ")).toEqual([])
      expect(parseStreamLine("not json")).toEqual([])
      expect(parseStreamLine(line({ type: "rate_limit_event" }))).toEqual([])
      expect(parseStreamLine(line({ type: "system", subtype: "init" }))).toEqual([])
    })

    it("emits nothing for an assistant line with no usable content", () => {
      expect(parseStreamLine(line({ type: "assistant" }))).toEqual([])
      expect(parseStreamLine(assistant({ content: [] }))).toEqual([])
      expect(parseStreamLine(assistant({ content: [{ type: "thinking", thinking: "", signature: "s" }] }))).toEqual([])
      expect(parseStreamLine(assistant({ content: [{ type: "text", text: "  \n" }] }))).toEqual([])
    })
  })

  describe("assistant messages", () => {
    it("carries the message id and its text and calls in order", () => {
      const events = parseStreamLine(
        assistant({
          id: "msg_a",
          content: [
            { type: "text", text: "Looking." },
            { type: "tool_use", id: "toolu_1", name: "mcp__capy__list_accounts", input: { all: true } },
            { type: "text", text: " " },
          ],
          stop_reason: null,
        }),
      )
      expect(events).toEqual([
        {
          type: "message",
          id: "msg_a",
          parts: [
            { type: "text", text: "Looking." },
            { type: "call", id: "toolu_1", name: "list_accounts", input: { all: true } },
          ],
        },
      ])
    })

    it("omits the id when the message has none and keeps unprefixed tool names", () => {
      expect(parseStreamLine(assistant({ content: [{ type: "tool_use", id: "t", name: "render_table" }] }))).toEqual([
        { type: "message", parts: [{ type: "call", id: "t", name: "render_table", input: {} }] },
      ])
    })
  })

  describe("tool results", () => {
    it("reports each tool_result with its ok flag", () => {
      const events = parseStreamLine(
        line({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "a", content: "ok" },
              { type: "tool_result", tool_use_id: "b", content: "boom", is_error: true },
              { type: "text", text: "not a result" },
            ],
          },
        }),
      )
      expect(events).toEqual([
        { type: "tool-result", id: "a", ok: true },
        { type: "tool-result", id: "b", ok: false },
      ])
    })
  })

  describe("endings", () => {
    it("ends with done on a successful result", () => {
      expect(parseStreamLine(line({ type: "result", subtype: "success", stop_reason: "end_turn" }))).toEqual([
        { type: "result", event: { type: "done" } },
      ])
      expect(parseStreamLine(line({ type: "result" }))).toEqual([{ type: "result", event: { type: "done" } }])
    })

    it("maps the result's stop_reason onto the shared ending vocabulary", () => {
      const ending = (stop_reason: string) =>
        parseStreamLine(line({ type: "result", subtype: "success", is_error: false, stop_reason }))
      expect(ending("stop_sequence")).toEqual([{ type: "result", event: endingEvent("done") }])
      expect(ending("max_tokens")).toEqual([{ type: "result", event: endingEvent("cutOff") }])
      expect(ending("refusal")).toEqual([{ type: "result", event: endingEvent("refused") }])
      expect(ending("pause_turn")).toEqual([{ type: "result", event: endingEvent("cutOff") }])
    })

    it("maps a terminal stop_reason on an assistant message the same way, after its content", () => {
      expect(parseStreamLine(assistant({ content: [{ type: "text", text: "Cut" }], stop_reason: "max_tokens" }))).toEqual([
        { type: "message", parts: [{ type: "text", text: "Cut" }] },
        { type: "end", event: endingEvent("cutOff") },
      ])
      expect(parseStreamLine(assistant({ content: [{ type: "text", text: "No." }], stop_reason: "refusal" }))).toContainEqual({
        type: "end",
        event: endingEvent("refused"),
      })
      expect(parseStreamLine(assistant({ content: [{ type: "text", text: "Hi" }], stop_reason: "end_turn" }))).toContainEqual({
        type: "end",
        event: { type: "done" },
      })
    })

    it("keeps going on a tool_use stop_reason", () => {
      const events = parseStreamLine(
        assistant({ content: [{ type: "tool_use", id: "t", name: "list_accounts", input: {} }], stop_reason: "tool_use" }),
      )
      expect(events.some((e) => e.type === "end")).toBe(false)
    })

    it("maps an error_max_turns result to budgetExhausted", () => {
      expect(
        parseStreamLine(
          line({
            type: "result",
            subtype: "error_max_turns",
            is_error: true,
            stop_reason: "tool_use",
            errors: ["Reached maximum number of turns (100)"],
          }),
        ),
      ).toEqual([{ type: "result", event: endingEvent("budgetExhausted") }])
    })

    it("surfaces the result text of a failed run, then its first error, then a fallback", () => {
      expect(parseStreamLine(line({ type: "result", is_error: true, result: "Prompt is too long", errors: ["other"] }))).toEqual([
        { type: "result", event: { type: "error", message: "Prompt is too long" } },
      ])
      expect(parseStreamLine(line({ type: "result", is_error: true, subtype: "error_during_execution", errors: ["Tool crashed"] }))).toEqual([
        { type: "result", event: { type: "error", message: "Tool crashed" } },
      ])
      expect(parseStreamLine(line({ type: "result", is_error: true }))).toEqual([
        { type: "result", event: { type: "error", message: "Claude Code ended the reply with an error." } },
      ])
    })

    it("unwraps an API error body and keeps its status", () => {
      const body = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 226000 tokens > 200000 maximum" } })
      expect(parseStreamLine(line({ type: "result", is_error: true, result: `API Error: 400 ${body}` }))).toEqual([
        { type: "result", event: { type: "error", message: "prompt is too long: 226000 tokens > 200000 maximum", status: 400 } },
      ])
      expect(parseStreamLine(line({ type: "result", is_error: true, result: "Overloaded", api_error_status: 529 }))).toEqual([
        { type: "result", event: { type: "error", message: "Overloaded", status: 529 } },
      ])
    })

    it("words a 429 as a rate limit", () => {
      expect(parseStreamLine(line({ type: "result", is_error: true, result: "Too many requests", api_error_status: 429 }))).toEqual([
        { type: "result", event: { type: "error", message: "Too many requests", status: 429, code: "rateLimited" } },
      ])
    })

    it("ends on an assistant message the CLI marks as an error instead of showing its text", () => {
      expect(
        parseStreamLine(
          assistant({ model: "<synthetic>", content: [{ type: "text", text: "Prompt is too long" }] }, { error: "invalid_request" }),
        ),
      ).toEqual([{ type: "end", event: { type: "error", message: "Prompt is too long" } }])
    })

    it("maps the CLI's output-limit and rate-limit error messages onto their codes", () => {
      expect(
        parseStreamLine(assistant({ content: [{ type: "text", text: "API Error: exceeded" }] }, { error: "max_output_tokens" })),
      ).toEqual([{ type: "end", event: endingEvent("cutOff") }])
      expect(parseStreamLine(assistant({ content: [{ type: "text", text: "Limit reached" }] }, { error: "rate_limit" }))).toEqual([
        { type: "end", event: { type: "error", message: "Limit reached", code: "rateLimited" } },
      ])
    })

    it("ends the turn early on a top-level error line", () => {
      expect(parseStreamLine(line({ type: "error", error: { message: "Rate limit exceeded" } }))).toEqual([
        { type: "end", event: { type: "error", message: "Rate limit exceeded" } },
      ])
      expect(parseStreamLine(line({ type: "error" }))).toEqual([
        { type: "end", event: { type: "error", message: "Claude Code ended the reply with an error." } },
      ])
    })
  })
})
