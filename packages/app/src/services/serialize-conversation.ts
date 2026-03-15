/**
 * Serialize chat messages into a text summary for context forwarding
 * when a session is interrupted and resumed.
 */

import type { ChatMessage } from "@capybudget/intelligence"

export function serializeConversation(messages: ChatMessage[], maxChars: number): string {
  const lines: string[] = []

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Capy"
    for (const block of msg.blocks) {
      if (block.type === "text") {
        lines.push(`${role}: ${block.content}`)
      } else if (block.type === "tool-activity") {
        lines.push(`[Tool: ${block.tool}]`)
      }
      // Skip tables/charts — too verbose for context
    }
  }

  let text = lines.join("\n")
  if (text.length > maxChars) {
    text = "...\n" + text.slice(-maxChars)
  }
  return text
}
