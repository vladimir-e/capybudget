import { describe, it, expect } from "vitest"
import { parseStreamLine } from "@/services/claude-cli-stream"

describe("parseStreamLine", () => {
  describe("assistant text blocks", () => {
    it("parses a text block into a content event", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello there" }],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "text", content: "Hello there" }],
        },
      ])
    })

    it("cumulative text replaces — parser just relays full blocks", () => {
      const first = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hel" }],
        },
      })
      const second = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      })

      expect(parseStreamLine(first)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Hel" }] },
      ])
      expect(parseStreamLine(second)).toEqual([
        { type: "content", blocks: [{ type: "text", content: "Hello world" }] },
      ])
    })
  })

  describe("messageId propagation", () => {
    it("attaches message.id to the content event when present", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_abc123",
          content: [{ type: "text", text: "Hello" }],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "text", content: "Hello" }],
          messageId: "msg_abc123",
        },
      ])
    })

    it("omits messageId when the assistant event has no message.id", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello" }],
        },
      })

      const events = parseStreamLine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).not.toHaveProperty("messageId")
    })
  })

  describe("empty / whitespace text alongside other blocks", () => {
    it("drops whitespace-only text but preserves a sibling tool_use", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "  " },
            { type: "tool_use", name: "list_accounts", input: {} },
          ],
        },
      })

      expect(parseStreamLine(line)).toEqual([
        {
          type: "content",
          blocks: [{ type: "tool-activity", tool: "list_accounts" }],
        },
      ])
    })
  })
})
