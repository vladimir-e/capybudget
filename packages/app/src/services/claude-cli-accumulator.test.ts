import { describe, it, expect } from "vitest"
import type { ContentBlock, StreamEvent } from "@capybudget/intelligence"
import { CycleAccumulator } from "@/services/claude-cli-accumulator"
import { parseStreamLine } from "@/services/claude-cli-stream"

function text(content: string): ContentBlock {
  return { type: "text", content }
}

function content(blocks: ContentBlock[], messageId?: string): StreamEvent {
  return messageId ? { type: "content", blocks, messageId } : { type: "content", blocks }
}

function lastBlocks(acc: CycleAccumulator, events: StreamEvent[]): ContentBlock[] {
  let blocks: ContentBlock[] = []
  for (const event of events) {
    const out = acc.accumulate(event)
    if (out.type === "content") blocks = out.blocks
  }
  return blocks
}

describe("CycleAccumulator", () => {
  describe("text accumulation (per-block semantics)", () => {
    it("replaces the in-progress text when the incoming text is a snapshot extension", () => {
      const acc = new CycleAccumulator()
      const blocks = lastBlocks(acc, [
        content([text("Hel")], "msg_a"),
        content([text("Hello world")], "msg_a"),
      ])
      expect(blocks).toEqual([text("Hello world")])
    })

    it("replaces the in-progress text when the incoming text is identical", () => {
      const acc = new CycleAccumulator()
      const blocks = lastBlocks(acc, [
        content([text("Same answer.")], "msg_a"),
        content([text("Same answer.")], "msg_a"),
      ])
      expect(blocks).toEqual([text("Same answer.")])
    })

    it("appends same-id distinct texts as separate blocks", () => {
      const acc = new CycleAccumulator()
      const blocks = lastBlocks(acc, [
        content([text("First point.")], "msg_a"),
        content([text("Second, unrelated point.")], "msg_a"),
      ])
      expect(blocks).toEqual([text("First point."), text("Second, unrelated point.")])
    })

    it("appends prefix-extending text across a messageId boundary (promotion resets the index)", () => {
      const acc = new CycleAccumulator()
      const blocks = lastBlocks(acc, [
        content([text("Numbers:")], "msg_a"),
        content([text("Numbers: none this month.")], "msg_b"),
      ])
      expect(blocks).toEqual([text("Numbers:"), text("Numbers: none this month.")])
    })

    it("handles id-less cumulative snapshots (no messageId at all)", () => {
      const acc = new CycleAccumulator()
      const blocks = lastBlocks(acc, [
        content([text("Hel")]),
        content([text("Hello world")]),
      ])
      expect(blocks).toEqual([text("Hello world")])
    })
  })

  describe("terminal-signal parity (followups end the cycle's text)", () => {
    it("drops text arriving after a followups block within the same cycle", () => {
      const acc = new CycleAccumulator()
      const chips = [{ label: "More", prompt: "Tell me more" }]
      const blocks = lastBlocks(acc, [
        content([text("Here's your answer.")], "msg_a"),
        content([{ type: "followups", chips }], "msg_b"),
        content([text("Trailing rambling the contract says shouldn't exist.")], "msg_c"),
      ])
      expect(blocks).toEqual([
        text("Here's your answer."),
        { type: "followups", chips },
      ])
    })

    it("keeps trailing text in a cycle without followups", () => {
      const acc = new CycleAccumulator()
      const blocks = lastBlocks(acc, [
        content([text("Working on it.")], "msg_a"),
        content([{ type: "tool-activity", tool: "list_accounts" }], "msg_a"),
        content([text("Done — all set.")], "msg_b"),
      ])
      expect(blocks).toEqual([
        text("Working on it."),
        { type: "tool-activity", tool: "list_accounts" },
        text("Done — all set."),
      ])
    })

    it("drops text following followups within a single multi-block event", () => {
      const acc = new CycleAccumulator()
      const chips = [{ label: "More", prompt: "Tell me more" }]
      const blocks = lastBlocks(acc, [
        content(
          [{ type: "followups", chips }, text("Trailing text in the same event.")],
          "msg_a",
        ),
      ])
      expect(blocks).toEqual([{ type: "followups", chips }])
    })

    it("clears the followups latch on done so the next cycle's text renders", () => {
      const acc = new CycleAccumulator()
      const chips = [{ label: "More", prompt: "Tell me more" }]
      acc.accumulate(content([{ type: "followups", chips }], "msg_a"))
      acc.accumulate({ type: "done" })
      const blocks = lastBlocks(acc, [content([text("Next cycle's reply.")], "msg_b")])
      expect(blocks).toEqual([text("Next cycle's reply.")])
    })

    it("clears the followups latch on error too — replay relies on it for is_error cycles", () => {
      const acc = new CycleAccumulator()
      const chips = [{ label: "More", prompt: "Tell me more" }]
      acc.accumulate(content([{ type: "followups", chips }], "msg_a"))
      acc.accumulate({ type: "error", message: "boom" })
      const blocks = lastBlocks(acc, [content([text("Reply after the failed cycle.")], "msg_b")])
      expect(blocks).toEqual([text("Reply after the failed cycle.")])
    })

    it("still appends non-text blocks after the latch arms — only text is dropped", () => {
      const acc = new CycleAccumulator()
      const chips = [{ label: "More", prompt: "Tell me more" }]
      const table: ContentBlock = { type: "table", headers: ["A"], rows: [["1"]] }
      const blocks = lastBlocks(acc, [
        content([{ type: "followups", chips }], "msg_a"),
        content([table], "msg_b"),
        content([text("Dropped trailing text.")], "msg_c"),
      ])
      expect(blocks).toEqual([{ type: "followups", chips }, table])
    })
  })

  describe("integration with parseStreamLine", () => {
    function assistantLine(
      id: string,
      blocks: Array<Record<string, unknown>>,
    ): string {
      return JSON.stringify({ type: "assistant", message: { id, content: blocks } })
    }

    function replay(lines: string[]): ContentBlock[] {
      const acc = new CycleAccumulator()
      let blocks: ContentBlock[] = []
      for (const line of lines) {
        for (const event of parseStreamLine(line)) {
          const out = acc.accumulate(event)
          if (out.type === "content") blocks = out.blocks
        }
      }
      return blocks
    }

    it("a thinking-only gap between same-id texts does not clobber the earlier text", () => {
      const blocks = replay([
        assistantLine("msg_a", [{ type: "text", text: "The real answer." }]),
        assistantLine("msg_a", [{ type: "thinking", thinking: "hmm", signature: "sig" }]),
        assistantLine("msg_a", [{ type: "text", text: "A different afterthought." }]),
      ])
      expect(blocks).toEqual([
        text("The real answer."),
        text("A different afterthought."),
      ])
    })

    it("a null-render tool-activity fallback resets the in-progress text index", () => {
      const blocks = replay([
        assistantLine("msg_a", [{ type: "text", text: "Numbers:" }]),
        // Invalid render input → builder returns null → tool-activity fallback.
        assistantLine("msg_a", [
          { type: "tool_use", name: "render_table", input: { headers: [], rows: [] } },
        ]),
        // startsWith the earlier text, but the tool block in between means
        // it must append as a new block, not replace across the gap.
        assistantLine("msg_a", [{ type: "text", text: "Numbers: none, table failed." }]),
      ])
      expect(blocks).toEqual([
        text("Numbers:"),
        { type: "tool-activity", tool: "render_table" },
        text("Numbers: none, table failed."),
      ])
    })

    it("an invalid followups payload does not arm the latch — recovery text still renders", () => {
      const blocks = replay([
        assistantLine("msg_a", [
          { type: "tool_use", name: "render_followups", input: { chips: [] } },
        ]),
        assistantLine("msg_b", [
          { type: "text", text: "Couldn't render suggestions — anything else?" },
        ]),
      ])
      expect(blocks).toEqual([
        { type: "tool-activity", tool: "render_followups" },
        text("Couldn't render suggestions — anything else?"),
      ])
    })
  })
})
