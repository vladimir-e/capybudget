import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import type { ChatMessage, ContentBlock } from "@capybudget/intelligence"
import { MessageBubble } from "./capy-message-bubble"

function statuses(blocks: ContentBlock[], isStreaming: boolean): (string | null)[] {
  const message: ChatMessage = { id: "m", role: "assistant", blocks }
  const { container } = render(<MessageBubble message={message} isStreaming={isStreaming} onSend={() => {}} />)
  return Array.from(container.querySelectorAll("[data-status]")).map((row) => row.getAttribute("data-status"))
}

describe("MessageBubble tool card", () => {
  it("shows each call's own status, not its position", () => {
    expect(
      statuses(
        [
          { type: "tool-activity", tool: "create_transaction", status: "failed" },
          { type: "tool-activity", tool: "create_transaction", status: "running" },
          { type: "tool-activity", tool: "list_accounts", status: "pending" },
        ],
        true,
      ),
    ).toEqual(["failed", "running", "pending"])
  })

  it("never spins once the message has settled", () => {
    expect(
      statuses([{ type: "tool-activity", tool: "create_transaction", status: "running" }], false),
    ).toEqual(["done"])
  })

  it("falls back to position for status-less Claude CLI blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "tool-activity", tool: "list_accounts" },
      { type: "tool-activity", tool: "list_categories" },
    ]
    expect(statuses(blocks, true)).toEqual(["done", "running"])
    expect(statuses(blocks, false)).toEqual(["done", "done"])
  })
})
