import { describe, it, expect } from "vitest"
import { serializeConversation } from "./serialize-conversation"
import type { ChatMessage } from "@capybudget/intelligence"

function msg(role: "user" | "assistant", ...blocks: ChatMessage["blocks"]): ChatMessage {
  return { id: "test", role, blocks }
}

describe("serializeConversation", () => {
  it("returns empty string for no messages", () => {
    expect(serializeConversation([], 5000)).toBe("")
  })

  it("serializes text blocks with role labels", () => {
    const messages: ChatMessage[] = [
      msg("user", { type: "text", content: "Hello" }),
      msg("assistant", { type: "text", content: "Hi there!" }),
    ]
    expect(serializeConversation(messages, 5000)).toBe("User: Hello\nCapy: Hi there!")
  })

  it("serializes tool activity blocks", () => {
    const messages: ChatMessage[] = [
      msg("assistant", { type: "tool-activity", tool: "list_accounts" }),
    ]
    expect(serializeConversation(messages, 5000)).toBe("[Tool: list_accounts]")
  })

  it("skips table and chart blocks", () => {
    const messages: ChatMessage[] = [
      msg("assistant",
        { type: "text", content: "Here's the data:" },
        { type: "table", headers: ["A"], rows: [["1"]] },
        { type: "bar-chart", title: "Chart", data: [{ label: "x", value: 1 }] },
        { type: "donut-chart", title: "Donut", data: [{ label: "y", value: 2 }] },
      ),
    ]
    expect(serializeConversation(messages, 5000)).toBe("Capy: Here's the data:")
  })

  it("handles multiple blocks per message", () => {
    const messages: ChatMessage[] = [
      msg("assistant",
        { type: "text", content: "Let me check." },
        { type: "tool-activity", tool: "spending_summary" },
        { type: "text", content: "Here are the results." },
      ),
    ]
    expect(serializeConversation(messages, 5000)).toBe(
      "Capy: Let me check.\n[Tool: spending_summary]\nCapy: Here are the results.",
    )
  })

  it("truncates to maxChars with ellipsis prefix", () => {
    const messages: ChatMessage[] = [
      msg("user", { type: "text", content: "A".repeat(100) }),
      msg("assistant", { type: "text", content: "B".repeat(100) }),
    ]
    const result = serializeConversation(messages, 50)
    expect(result.startsWith("...\n")).toBe(true)
    // "...\n" is 4 chars, so the tail should be exactly 50 chars
    expect(result.length).toBe(54)
  })

  it("does not truncate when under maxChars", () => {
    const messages: ChatMessage[] = [
      msg("user", { type: "text", content: "Short" }),
    ]
    const result = serializeConversation(messages, 5000)
    expect(result).toBe("User: Short")
    expect(result.startsWith("...")).toBe(false)
  })
})
