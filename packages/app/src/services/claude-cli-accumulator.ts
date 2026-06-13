import type { ContentBlock, StreamEvent } from "@capybudget/intelligence"

/**
 * Accumulates parsed CLI stream events into the cumulative block list
 * the chat UI renders for one send-cycle. Pure — no Tauri imports — so
 * it is unit-testable and replayable from node
 * (`scripts/replay-cli-stream.ts`).
 *
 * Stream semantics this encodes (verified against CLI 2.1.176 captures):
 *
 * - The CLI emits one `assistant` event per content block, all sharing
 *   `message.id` — the id is even reused across tool_result boundaries.
 *   Same-id text blocks are therefore distinct blocks and must append.
 *   The exception: an incoming text that extends the in-progress one
 *   (`startsWith`) is a cumulative snapshot — older CLIs streamed text
 *   that way — and replaces it in place.
 *
 * - The model keeps talking after `render_followups` despite the
 *   prompt's terminal-signal contract. The Anthropic adapter ends its
 *   request loop at that tool; the CLI's loop can't be stopped from
 *   outside, so text after a followups block is dropped client-side
 *   for the rest of the cycle. The latch requires a *rendered*
 *   followups block — a failed render arrives here as tool-activity,
 *   so the model's recovery text still renders.
 */
export class CycleAccumulator {
  private finishedTurns: ContentBlock[] = []
  private currentTurnId: string | null = null
  private currentTurnBlocks: ContentBlock[] = []
  private inProgressTextIndex: number | null = null
  private followupsSeen = false

  accumulate(event: StreamEvent): StreamEvent {
    if (event.type === "done" || event.type === "error") {
      this.reset()
      return event
    }
    if (event.type !== "content") return event

    const incomingId = event.messageId
    if (incomingId !== undefined && incomingId !== this.currentTurnId) {
      if (this.currentTurnBlocks.length > 0) {
        this.finishedTurns.push(...this.currentTurnBlocks)
      }
      this.currentTurnId = incomingId
      this.currentTurnBlocks = []
      this.inProgressTextIndex = null
    }

    for (const block of event.blocks) {
      if (block.type === "text") {
        if (this.followupsSeen) continue
        const idx = this.inProgressTextIndex
        const inProgress = idx !== null ? this.currentTurnBlocks[idx] : null
        if (
          idx !== null &&
          inProgress?.type === "text" &&
          block.content.startsWith(inProgress.content)
        ) {
          this.currentTurnBlocks[idx] = block
        } else {
          this.currentTurnBlocks.push(block)
          this.inProgressTextIndex = this.currentTurnBlocks.length - 1
        }
      } else {
        if (block.type === "followups") this.followupsSeen = true
        this.currentTurnBlocks.push(block)
        this.inProgressTextIndex = null
      }
    }

    return {
      type: "content",
      blocks: [...this.finishedTurns, ...this.currentTurnBlocks],
    }
  }

  reset(): void {
    this.finishedTurns = []
    this.currentTurnId = null
    this.currentTurnBlocks = []
    this.inProgressTextIndex = null
    this.followupsSeen = false
  }
}
