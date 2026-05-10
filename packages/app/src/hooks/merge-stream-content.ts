/**
 * Merge a `StreamEvent.content` payload into the running message list.
 *
 * Stream contract: every adapter emits `StreamEvent.content` with the
 * **complete cumulative blocks array** for the current assistant turn —
 * never deltas. This helper replaces the trailing assistant message's
 * blocks wholesale, so non-text blocks (tool-activity, charts,
 * attachments) never duplicate as the stream progresses.
 *
 * The pre-Phase-10.5b implementation iterated each event's blocks and
 * appended every non-text block, plus used prefix-detection on text to
 * decide between "replace last text" and "append new text". That logic
 * mistook cumulative arrays for deltas — fine while every assistant
 * turn was just text+tool, broken the moment the demo started emitting
 * a chart followed by another text block (chart re-pushed on every
 * tick, answer rendering "4–5 times").
 */

import type { ChatMessage, ContentBlock } from "@capybudget/intelligence"

/**
 * Replace the trailing assistant message's blocks with the cumulative
 * `blocks` array. If the trailing message isn't an assistant turn (or
 * there are no messages), the input is returned unchanged — the caller
 * is responsible for ensuring an assistant placeholder exists before
 * the first stream event arrives.
 */
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
