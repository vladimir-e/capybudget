import type { SessionEvent, MessageContent, ChatMessage } from "./types"

export interface CapySessionOptions {
  budgetPath: string
  mcpServerPath: string
  onEvent: (event: SessionEvent) => void
}

export interface CapySession {
  send(content: MessageContent): Promise<void>
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
