/**
 * Replace the trailing assistant message's blocks with the cumulative
 * array for the current user→done cycle. Adapters own accumulation
 * across agentic-loop iterations; this helper just swaps wholesale.
 */

import type { ChatMessage, ContentBlock } from "@capybudget/intelligence"

export function mergeStreamContent(
  messages: ChatMessage[],
  blocks: ContentBlock[],
): ChatMessage[] {
  const last = messages[messages.length - 1]
  if (last?.role !== "assistant") return messages
  const updated = [...messages]
  updated[updated.length - 1] = { ...last, blocks: [...blocks] }
  return updated
}
