import type { SessionEvent, MessageContent } from "./types"

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
}
