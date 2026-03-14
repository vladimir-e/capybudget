import type { SessionEvent } from "./types"

export interface CapySessionOptions {
  budgetPath: string
  mcpServerPath: string
  onEvent: (event: SessionEvent) => void
}

export interface CapySession {
  send(message: string): Promise<void>
  restart(): Promise<void>
  kill(): Promise<void>
  readonly isAlive: boolean
}
