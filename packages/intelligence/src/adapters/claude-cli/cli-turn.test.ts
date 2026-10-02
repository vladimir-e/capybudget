import { describe, it, expect } from "vitest"
import type { ContentBlock, StreamEvent } from "../../types"
import { endingEvent } from "../agent-turn"
import { CliTurn } from "./cli-turn"

const chips = [{ label: "More", prompt: "Tell me more" }]

function text(content: string): ContentBlock {
  return { type: "text", content }
}

function say(id: string | undefined, ...content: Array<Record<string, unknown>>): string {
  return JSON.stringify({ type: "assistant", message: { ...(id ? { id } : {}), content } })
}

function textPart(value: string): Record<string, unknown> {
  return { type: "text", text: value }
}

function call(id: string, name: string, input: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "tool_use", id, name: `mcp__capy__${name}`, input }
}

function followups(id: string): Record<string, unknown> {
  return call(id, "render_followups", { chips })
}

function result(id: string, isError = false): string {
  return JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError }] } })
}

const DONE = JSON.stringify({ type: "result", subtype: "success", stop_reason: "end_turn" })

function play(lines: string[]): { events: StreamEvent[]; blocks: ContentBlock[]; turn: CliTurn } {
  const events: StreamEvent[] = []
  const turn = new CliTurn((event) => events.push(event))
  for (const line of lines) turn.feed(line)
  const contents = events.flatMap((e) => (e.type === "content" ? [e.blocks] : []))
  return { events, blocks: contents[contents.length - 1] ?? [], turn }
}

describe("CliTurn", () => {
  describe("text", () => {
    it("replaces the in-progress text with a snapshot that extends it", () => {
      expect(play([say("a", textPart("Hel")), say("a", textPart("Hello world"))]).blocks).toEqual([text("Hello world")])
      expect(play([say(undefined, textPart("Hel")), say(undefined, textPart("Hello"))]).blocks).toEqual([text("Hello")])
    })

    it("keeps an identical repeat as one block", () => {
      expect(play([say("a", textPart("Same.")), say("a", textPart("Same."))]).blocks).toEqual([text("Same.")])
    })

    it("appends a distinct same-id text as its own block", () => {
      expect(play([say("a", textPart("First.")), say("a", textPart("Second."))]).blocks).toEqual([
        text("First."),
        text("Second."),
      ])
    })

    it("starts a new block when the message id changes, even for an extending text", () => {
      expect(play([say("a", textPart("Numbers:")), say("b", textPart("Numbers: none."))]).blocks).toEqual([
        text("Numbers:"),
        text("Numbers: none."),
      ])
    })

    it("starts a new block after a call, even for an extending text", () => {
      expect(
        play([
          say("a", textPart("Numbers:")),
          say("a", call("t1", "render_table", { headers: [], rows: [] })),
          say("a", textPart("Numbers: none, table failed.")),
        ]).blocks,
      ).toEqual([text("Numbers:"), { type: "tool-activity", tool: "render_table", status: "running" }, text("Numbers: none, table failed.")])
    })

    it("does not let a thinking-only line clobber the earlier text", () => {
      expect(
        play([
          say("a", textPart("The real answer.")),
          say("a", { type: "thinking", thinking: "hmm", signature: "sig" }),
          say("a", textPart("An afterthought.")),
        ]).blocks,
      ).toEqual([text("The real answer."), text("An afterthought.")])
    })
  })

  describe("calls", () => {
    it("renders a render tool's block and keeps it through later messages", () => {
      const table = { type: "table", headers: ["Category"], rows: [["Food"]] }
      expect(
        play([
          say("a", textPart("Here's the split:"), call("t1", "render_chart", { title: "Spending", type: "donut", data: [{ label: "Food", value: 50 }] })),
          say("b", call("t2", "render_table", { headers: ["Category"], rows: [["Food"]] })),
        ]).blocks,
      ).toEqual([
        text("Here's the split:"),
        { type: "donut-chart", title: "Spending", data: [{ label: "Food", value: 50 }] },
        table,
      ])
    })

    it("tracks a tool card from running to done or failed and reports each result", () => {
      const { events, blocks } = play([
        say("a", call("t1", "create_transaction"), call("t2", "list_accounts")),
        result("t1"),
        result("t2", true),
      ])
      expect(blocks).toEqual([
        { type: "tool-activity", tool: "create_transaction", status: "done" },
        { type: "tool-activity", tool: "list_accounts", status: "failed" },
      ])
      expect(events.filter((e) => e.type === "tool-result")).toEqual([
        { type: "tool-result", tool: "create_transaction", id: "t1", ok: true },
        { type: "tool-result", tool: "list_accounts", id: "t2", ok: false },
      ])
    })

    it("ignores a result for a call this turn never saw", () => {
      expect(play([result("stranger")]).events).toEqual([])
    })
  })

  describe("followups end the turn's text", () => {
    it("drops text after a rendered followups block, in the same line or later", () => {
      expect(play([say("a", textPart("Answer.")), say("b", followups("f"), textPart("Trailing.")), say("c", textPart("More."))]).blocks).toEqual([
        text("Answer."),
        { type: "followups", chips },
      ])
    })

    it("still shows non-text blocks after followups", () => {
      expect(play([say("a", followups("f")), say("b", call("t", "render_table", { headers: ["A"], rows: [["1"]] }))]).blocks).toEqual([
        { type: "followups", chips },
        { type: "table", headers: ["A"], rows: [["1"]] },
      ])
    })

    it("keeps the recovery text after a followups payload that failed to render", () => {
      expect(play([say("a", call("f", "render_followups", { chips: [] })), say("b", textPart("Anything else?"))]).blocks).toEqual([
        { type: "tool-activity", tool: "render_followups", status: "running" },
        text("Anything else?"),
      ])
    })
  })

  describe("ending", () => {
    it("ends once, on the first terminal line, and emits nothing after", () => {
      const { events, turn } = play([
        JSON.stringify({ type: "assistant", message: { content: [textPart("Hi")], stop_reason: "end_turn" } }),
        DONE,
        say("z", textPart("late")),
      ])
      expect(turn.isOver).toBe(true)
      expect(events).toEqual([{ type: "content", blocks: [text("Hi")] }, { type: "done" }])
    })

    it("ends a cut-off reply with the shared cutOff error, keeping what streamed", () => {
      const { events, blocks } = play([
        say("a", textPart("Partial")),
        JSON.stringify({ type: "result", subtype: "success", stop_reason: "max_tokens" }),
      ])
      expect(blocks).toEqual([text("Partial")])
      expect(events[events.length - 1]).toEqual(endingEvent("cutOff"))
    })

    it("ends on a CLI error message without showing its text", () => {
      const { events } = play([
        JSON.stringify({ type: "assistant", error: "invalid_request", message: { content: [textPart("Prompt is too long")] } }),
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Prompt is too long" }),
      ])
      expect(events).toEqual([{ type: "error", message: "Prompt is too long" }])
    })
  })
})
