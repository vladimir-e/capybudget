import { describe, expect, it } from "vitest"
import type { ChatMessage, ContentBlock } from "@capybudget/intelligence"
import { mergeStreamContent } from "./merge-stream-content"

function user(text: string): ChatMessage {
  return {
    id: `u-${text}`,
    role: "user",
    blocks: [{ type: "text", content: text }],
  }
}

function assistant(blocks: ContentBlock[] = []): ChatMessage {
  return { id: "a", role: "assistant", blocks }
}

describe("mergeStreamContent", () => {
  it("replaces the trailing assistant blocks with the cumulative array", () => {
    const before: ChatMessage[] = [user("hi"), assistant([{ type: "text", content: "Hello" }])]
    const after = mergeStreamContent(before, [
      { type: "text", content: "Hello, world" },
    ])
    expect(after[1].blocks).toEqual([{ type: "text", content: "Hello, world" }])
  })

  it("does not duplicate non-text blocks across cumulative ticks", () => {
    // Reproduces the demo regression: the demo emits cumulative blocks
    // (tool, then text added, then donut added, then text added again).
    // The pre-Phase-10.5b implementation pushed the tool and donut on
    // every tick — the answer "rendered 4-5 times".
    let state: ChatMessage[] = [user("hi"), assistant([])]

    // Tick 1: tool arrives.
    state = mergeStreamContent(state, [
      { type: "tool-activity", tool: "list_transactions" },
    ])

    // Tick 2: text starts streaming.
    state = mergeStreamContent(state, [
      { type: "tool-activity", tool: "list_transactions" },
      { type: "text", content: "Here's what I found." },
    ])

    // Tick 3: donut chart appears.
    state = mergeStreamContent(state, [
      { type: "tool-activity", tool: "list_transactions" },
      { type: "text", content: "Here's what I found." },
      { type: "donut-chart", title: "Spending", data: [{ label: "Food", value: 50 }] },
    ])

    // Tick 4: closing text streams in.
    state = mergeStreamContent(state, [
      { type: "tool-activity", tool: "list_transactions" },
      { type: "text", content: "Here's what I found." },
      { type: "donut-chart", title: "Spending", data: [{ label: "Food", value: 50 }] },
      { type: "text", content: "Hope this helps!" },
    ])

    const blocks = state[1].blocks
    expect(blocks.filter((b) => b.type === "tool-activity")).toHaveLength(1)
    expect(blocks.filter((b) => b.type === "donut-chart")).toHaveLength(1)
    expect(blocks.filter((b) => b.type === "text")).toHaveLength(2)
    expect(blocks).toHaveLength(4)
  })

  it("returns the input unchanged when the trailing message is from the user", () => {
    const before: ChatMessage[] = [user("hi")]
    const after = mergeStreamContent(before, [{ type: "text", content: "ignored" }])
    expect(after).toBe(before)
  })

  it("returns the input unchanged when the message list is empty", () => {
    const before: ChatMessage[] = []
    const after = mergeStreamContent(before, [{ type: "text", content: "ignored" }])
    expect(after).toBe(before)
  })

  it("preserves earlier messages and only mutates the trailing assistant", () => {
    const before: ChatMessage[] = [
      user("first"),
      assistant([{ type: "text", content: "answer one" }]),
      user("second"),
      assistant([{ type: "text", content: "partial" }]),
    ]
    const after = mergeStreamContent(before, [{ type: "text", content: "complete" }])
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
    expect(after[3].blocks).toEqual([{ type: "text", content: "complete" }])
  })

  it("clones the blocks array — mutating the input afterwards does not affect state", () => {
    const before: ChatMessage[] = [user("hi"), assistant([])]
    const blocks: ContentBlock[] = [{ type: "text", content: "Hello" }]
    const after = mergeStreamContent(before, blocks)
    blocks.push({ type: "text", content: "mutated" })
    expect(after[1].blocks).toEqual([{ type: "text", content: "Hello" }])
  })
})
