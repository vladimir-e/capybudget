/**
 * Claude Code CLI adapter — implements the CapySession interface as a
 * long-lived `claude` subprocess driven over stdin/stdout via Tauri's
 * shell plugin. The MCP server is the tool-execution transport.
 *
 * Lifecycle:
 * - Lazy spawn on first message
 * - Stays alive in background (independent of overlay open/close)
 * - "New chat" kills and respawns with a fresh session ID
 * - stop() kills the process and generates a new session ID (old one may be broken)
 *
 * Stop+resume recovery: the CLI session ID can't resume mid-turn, so
 * the next `send()` after a `stop()` opens with a fresh process. To
 * keep the model in context, the next user content is prefixed with a
 * serialized `[Previous conversation]` snippet derived from the chat
 * history the hook hands over via `markInterrupted(...)`. API adapters
 * preserve their own `messages` arrays so they don't implement this.
 *
 * Wire format: the CLI speaks stream-json. The decoder
 * (`parseStreamLine` in `claude-cli-stream.ts`) is an internal detail —
 * the consumer side only ever sees typed `StreamEvent`s. Process-level
 * events (stderr noise, unexpected exits, spawn failures) are handled
 * here too: stderr is logged at debug, exits route through `onExit`,
 * and spawn errors emit a `StreamEvent.error`.
 */

import { Command, type Child } from "@tauri-apps/plugin-shell"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { tempDir, join as joinPath } from "@tauri-apps/api/path"
import {
  SESSION_TOOL_CALL_BUDGET,
  type StreamEvent,
  type ClaudeCliAdapterOptions,
  type MessageContent,
  type CapySession,
  type ChatMessage,
} from "@capybudget/intelligence"
import { parseStreamLine } from "./claude-cli-stream"
import { serializeConversation } from "./serialize-conversation"

declare const __PROJECT_ROOT__: string

const RECOVERY_CONTEXT_MAX_CHARS = 5000

export class ClaudeCliSession implements CapySession {
  private child: Child | null = null
  private sessionId: string = crypto.randomUUID()
  private readonly budgetPath: string
  private readonly mcpServerPath: string
  private readonly systemPrompt: string
  private readonly onEvent: (event: StreamEvent) => void
  private readonly onExit?: () => void
  private killed = false
  /** Set by markInterrupted(); consumed (and cleared) on the next send. */
  private interruptedMessages: readonly ChatMessage[] | null = null

  constructor(opts: ClaudeCliAdapterOptions) {
    this.budgetPath = opts.budgetPath
    this.mcpServerPath = opts.mcpServerPath
    this.systemPrompt = opts.systemPrompt
    this.onEvent = opts.onEvent
    this.onExit = opts.onExit
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
      // Runaway-loop backstop. The CLI tracks turns itself and exits
      // with an `error_max_turns` result line when the cap trips; the
      // parser turns that into a StreamEvent.error.
      "--max-turns",
      String(SESSION_TOOL_CALL_BUDGET),
    ])

    command.stdout.on("data", (line: string) => {
      for (const event of parseStreamLine(line)) {
        // An error event means the CLI is shutting itself down (e.g.
        // `--max-turns` tripped). Mark the teardown as deliberate so
        // the close handler skips the unexpected-death onExit path.
        if (event.type === "error") this.killed = true
        this.onEvent(event)
      }
    })

    command.stderr.on("data", (line: string) => {
      // CLI warnings, npm/node noise, and similar — internal to the
      // subprocess, not surfaced to the consumer.
      console.debug("[claude-cli-stderr]", line)
    })

    command.on("close", () => {
      this.child = null
      // Only fire onExit on unexpected death — kill()/stop()/restart()
      // set this.killed first so deliberate teardowns stay quiet.
      if (!this.killed) {
        this.onExit?.()
      }
    })

    command.on("error", (error) => {
      this.onEvent({ type: "error", message: error })
    })

    this.child = await command.spawn()
  }

  /** Send a user message to Claude. Spawns the process if not alive. */
  async send(content: MessageContent): Promise<void> {
    if (!this.child) {
      await this.spawn()
    }

    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: this.applyRecoveryContext(content) },
    })

    await this.child!.write(payload + "\n")
  }

  /**
   * Mark the session as interrupted by the user (Stop). The hook hands
   * over the chat history so we can prepend a serialized
   * `[Previous conversation]` snippet on the next send — the CLI can't
   * resume mid-turn, so we synthesize the recovery context ourselves.
   * No-op if `priorMessages` is empty.
   */
  markInterrupted(priorMessages: readonly ChatMessage[]): void {
    if (priorMessages.length === 0) {
      this.interruptedMessages = null
      return
    }
    this.interruptedMessages = priorMessages
  }

  /**
   * If the previous turn was interrupted, prefix the next user content
   * with a `[Previous conversation]` snippet so the freshly-spawned
   * subprocess has the conversation in context. Idempotent — clears
   * the flag after applying so subsequent sends pass through cleanly.
   */
  private applyRecoveryContext(content: MessageContent): MessageContent {
    const prior = this.interruptedMessages
    if (!prior || prior.length === 0) return content
    this.interruptedMessages = null

    const prevContext = serializeConversation(prior, RECOVERY_CONTEXT_MAX_CHARS)
    const recoveryPrefix = [
      "[Previous conversation — session was interrupted by user]",
      prevContext,
      "[Session was interrupted. This is a fresh session. The user may want to continue the conversation — pick up where you left off or ask for clarification if needed.]",
      "",
    ].join("\n")

    if (typeof content === "string") {
      return `${recoveryPrefix}\n${content}`
    }
    // Multimodal: prepend a text block. Keep image blocks in their
    // original order so the model sees attachments alongside the
    // current message.
    return [
      { type: "text", text: recoveryPrefix },
      ...content,
    ]
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
    this.interruptedMessages = null
    // `killed` is reset by the next `spawn()`.
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
