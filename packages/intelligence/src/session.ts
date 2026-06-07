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
   */
  send(content: MessageContent, attachments?: readonly FileAttachment[]): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  kill(): Promise<void>
  readonly isAlive: boolean
  /**
   * Optional: signal to the adapter that the user interrupted the
   * previous turn (clicked Stop). Adapters that need a recovery
   * dance use this; API adapters that preserve `messages` natively
   * make it a no-op. The next `send()` is the post-interrupt turn —
   * the hook may pass `priorMessages` so the adapter can synthesize
   * a `[Previous conversation]` prefix when its own state isn't
   * enough to resume context.
   */
  markInterrupted?(priorMessages: readonly ChatMessage[]): void
}
