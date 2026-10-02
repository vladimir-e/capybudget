import type { StreamEvent, MessageContent, ChatMessage, FileAttachment } from "./types"

export interface CapySessionOptions {
  budgetPath: string
  mcpServerPath: string
  onEvent: (event: StreamEvent) => void
}

export interface CapySession {
  /**
   * Send a user turn. `attachments` carries the turn's raw files so the
   * in-process `start_import` tool can stage their bytes — the message
   * `content` flattens them (text inlined, images base64) past reconstruction,
   * and the model can't echo them back through a tool argument. The Claude CLI
   * adapter ignores it (file import routes through the Import tab there).
   * Queueing and resolution: specs/INTELLIGENCE.md § Session Interface.
   */
  send(content: MessageContent, attachments?: readonly FileAttachment[]): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  kill(): Promise<void>
  readonly isAlive: boolean
  /**
   * Optional: whether a send is waiting behind an earlier turn that is still
   * winding down. `stop()` cancels it before the model ever sees it.
   */
  readonly hasQueuedSend?: boolean
  /**
   * Optional: signal to the adapter that the previous turn was
   * interrupted (the user clicked Stop, or the process crashed).
   * Adapters that need a recovery dance use this; API adapters that
   * preserve `messages` natively make it a no-op. The next `send()` is
   * the post-interrupt turn — the hook may pass `priorMessages` so the
   * adapter can synthesize a `[Previous conversation]` prefix when its
   * own state isn't enough to resume context.
   */
  markInterrupted?(priorMessages: readonly ChatMessage[]): void
}
