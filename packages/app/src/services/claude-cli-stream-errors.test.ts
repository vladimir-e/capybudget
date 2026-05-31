import { describe, it, expect } from "vitest"
import { parseStreamLine } from "@/services/claude-cli-stream"

describe("parseStreamLine", () => {
  describe("empty / invalid input", () => {
    it("returns [] for empty string", () => {
      expect(parseStreamLine("")).toEqual([])
    })

    it("returns [] for whitespace-only string", () => {
      expect(parseStreamLine("   \t\n  ")).toEqual([])
    })

    it("returns [] for invalid JSON", () => {
      expect(parseStreamLine("not json at all")).toEqual([])
    })

    it("returns [] for unknown event type", () => {
      expect(parseStreamLine(JSON.stringify({ type: "ping" }))).toEqual([])
    })
  })

  describe("result event", () => {
    it("does NOT emit done on a clean result without cycleState (no safety net wired)", () => {
      const line = JSON.stringify({ type: "result" })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("does NOT emit a duplicate done when the assistant stop_reason already fired one", () => {
      const cycleState = { doneEmitted: false }
      const assistantEvents = parseStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "All done." }],
            stop_reason: "end_turn",
          },
        }),
        undefined,
        cycleState,
      )
      expect(assistantEvents).toContainEqual({ type: "done" })
      expect(cycleState.doneEmitted).toBe(true)

      const resultEvents = parseStreamLine(
        JSON.stringify({ type: "result" }),
        undefined,
        cycleState,
      )
      expect(resultEvents).toEqual([])
    })

    it("emits done off the result line as a safety net when no stop_reason fired", () => {
      const cycleState = { doneEmitted: false }
      parseStreamLine(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "partial" }] },
        }),
        undefined,
        cycleState,
      )
      expect(cycleState.doneEmitted).toBe(false)

      const resultEvents = parseStreamLine(
        JSON.stringify({ type: "result" }),
        undefined,
        cycleState,
      )
      expect(resultEvents).toEqual([{ type: "done" }])
      expect(cycleState.doneEmitted).toBe(true)
    })

    it("emits error when the result carries is_error (no safety-net done)", () => {
      const cycleState = { doneEmitted: false }
      const line = JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Reached maximum number of turns (100)"],
      })
      expect(parseStreamLine(line, undefined, cycleState)).toEqual([
        { type: "error", message: "Reached maximum number of turns (100)" },
      ])
      expect(cycleState.doneEmitted).toBe(false)
    })

    it("falls back to a generic message when is_error has no details", () => {
      const line = JSON.stringify({ type: "result", is_error: true })
      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Session terminated with an error." },
      ])
    })
  })

  describe("assistant stop_reason → done", () => {
    it("emits done after content when the assistant turn has stop_reason: end_turn", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "All done." }],
          stop_reason: "end_turn",
        },
      })
      expect(parseStreamLine(line)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "All done." }] },
        { type: "done" },
      ])
    })

    it("does not emit done when stop_reason is tool_use (more turns coming)", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "mcp__capy__list_accounts",
              input: {},
            },
          ],
          stop_reason: "tool_use",
        },
      })
      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "tool-activity", tool: "list_accounts" }],
        },
      ])
    })

    it("emits done for any terminal stop_reason (e.g. max_tokens)", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Cut off." }],
          stop_reason: "max_tokens",
        },
      })
      expect(parseStreamLine(line)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Cut off." }] },
        { type: "done" },
      ])
    })
  })

  describe("error event", () => {
    it("emits error with message", () => {
      const line = JSON.stringify({
        type: "error",
        error: { message: "Rate limit exceeded" },
      })

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Rate limit exceeded" },
      ])
    })

    it("falls back to 'Unknown error' when message is missing", () => {
      const line = JSON.stringify({
        type: "error",
        error: {},
      })

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Unknown error" },
      ])
    })

    it("falls back to 'Unknown error' when error object is missing", () => {
      const line = JSON.stringify({ type: "error" })

      expect(parseStreamLine(line)).toEqual([
        { type: "error", message: "Unknown error" },
      ])
    })
  })

  describe("assistant with empty / missing content", () => {
    it("returns [] when message has no content array", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {},
      })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("returns [] when message is missing", () => {
      const line = JSON.stringify({ type: "assistant" })
      expect(parseStreamLine(line)).toEqual([])
    })

    it("returns [] when content array is empty", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [] },
      })
      expect(parseStreamLine(line)).toEqual([])
    })
  })
})
