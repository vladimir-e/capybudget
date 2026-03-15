/**
 * Manages a long-lived Claude CLI subprocess via Tauri's shell plugin.
 *
 * Lifecycle:
 * - Lazy spawn on first message
 * - Stays alive in background (independent of overlay open/close)
 * - "New chat" kills and respawns with a fresh session ID
 * - stop() kills the process but preserves session ID for continuity
 */

import { Command, type Child } from "@tauri-apps/plugin-shell"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { tempDir, join as joinPath } from "@tauri-apps/api/path"
import {
  type SessionEvent,
  type CapySessionOptions,
} from "@capybudget/intelligence"

export type { SessionEvent, CapySessionOptions }

declare const __PROJECT_ROOT__: string

export class CapySession {
  private child: Child | null = null
  private sessionId: string = crypto.randomUUID()
  private readonly budgetPath: string
  private readonly mcpServerPath: string
  private readonly systemPrompt: string
  private readonly onEvent: (event: SessionEvent) => void
  private killed = false

  constructor(opts: CapySessionOptions & { systemPrompt: string }) {
    this.budgetPath = opts.budgetPath
    this.mcpServerPath = opts.mcpServerPath
    this.systemPrompt = opts.systemPrompt
    this.onEvent = opts.onEvent
  }

  get isAlive(): boolean {
    return this.child !== null
  }

  /** Spawn the Claude CLI process. Idempotent — no-op if already alive. */
  async spawn(): Promise<void> {
    if (this.child) return

    this.killed = false

    const absoluteServerPath = `${__PROJECT_ROOT__}/${this.mcpServerPath}`

    const mcpConfig = JSON.stringify({
      mcpServers: {
        capy: {
          command: "npx",
          args: ["tsx", absoluteServerPath],
          cwd: __PROJECT_ROOT__,
          env: { BUDGET_PATH: this.budgetPath },
        },
      },
    })

    // --mcp-config expects a file path, not inline JSON
    const tmp = await tempDir()
    const configPath = await joinPath(tmp, `capy-mcp-${this.sessionId}.json`)
    await writeTextFile(configPath, mcpConfig)

    const command = Command.create("claude", [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--mcp-config",
      configPath,
      "--system-prompt",
      this.systemPrompt,
      "--session-id",
      this.sessionId,
      "--allowedTools",
      "mcp__capy__*,Read",
      "--add-dir",
      this.budgetPath,
      "--setting-sources",
      "",
    ])

    command.stdout.on("data", (line: string) => {
      this.onEvent({ type: "stdout", line })
    })

    command.stderr.on("data", (line: string) => {
      this.onEvent({ type: "stderr", line })
    })

    command.on("close", (data) => {
      this.child = null
      if (!this.killed) {
        this.onEvent({ type: "exit", code: data.code })
      }
    })

    command.on("error", (error) => {
      this.onEvent({ type: "error", message: error })
    })

    this.child = await command.spawn()
  }

  /** Send a user message to Claude. Spawns the process if not alive. */
  async send(message: string): Promise<void> {
    if (!this.child) {
      await this.spawn()
    }

    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: message },
    })

    await this.child!.write(payload + "\n")
  }

  /**
   * Stop the current response.
   * Kills the process and generates a new session ID because Claude CLI
   * can't reliably resume a session that was interrupted mid-turn.
   * The UI keeps its own message history, so nothing is lost visually.
   */
  async stop(): Promise<void> {
    this.killed = true
    if (this.child) {
      try {
        await this.child.kill()
      } catch {
        // Process may already be dead
      }
      this.child = null
    }
    this.sessionId = crypto.randomUUID()
  }

  /** Kill the process and start fresh on next send(). */
  async restart(): Promise<void> {
    await this.kill()
    this.sessionId = crypto.randomUUID()
  }

  /** Kill the process. */
  async kill(): Promise<void> {
    this.killed = true
    if (this.child) {
      try {
        await this.child.kill()
      } catch {
        // Process may already be dead
      }
      this.child = null
    }
  }
}
