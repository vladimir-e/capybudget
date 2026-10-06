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

  it("never spins once the message has settled, and never claims an unresolved call succeeded", () => {
    expect(
      statuses([{ type: "tool-activity", tool: "create_transaction", status: "running" }], false),
    ).toEqual(["stopped"])
  })

  it("keeps the faint dot on a call that never ran, once the message has settled", () => {
    expect(
      statuses(
        [
          { type: "tool-activity", tool: "create_transaction", status: "failed" },
          { type: "tool-activity", tool: "list_accounts", status: "pending" },
        ],
        false,
      ),
    ).toEqual(["failed", "pending"])
  })
})

describe("MessageBubble unsent question", () => {
  it("marks a question the model never kept as not sent", () => {
    const message: ChatMessage = { id: "u", role: "user", blocks: [{ type: "text", content: "hi" }], unsent: true }
    const { getByText } = render(<MessageBubble message={message} isStreaming={false} onSend={() => {}} />)
    expect(getByText("Not sent")).toBeTruthy()
  })
})
