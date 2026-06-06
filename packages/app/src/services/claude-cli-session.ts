import { Command, type Child } from "@tauri-apps/plugin-shell"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { tempDir, join as joinPath } from "@tauri-apps/api/path"
import {
  SESSION_TOOL_CALL_BUDGET,
  type ContentBlock,
  type StreamEvent,
  type ClaudeCliAdapterOptions,
  type MessageContent,
  type CapySession,
  type ChatMessage,
} from "@capybudget/intelligence"
import { parseStreamLine, type CycleState } from "./claude-cli-stream"
import { serializeConversation } from "./serialize-conversation"

declare const __PROJECT_ROOT__: string

const RECOVERY_CONTEXT_MAX_CHARS = 5000

export class ClaudeCliSession implements CapySession {
  private child: Child | null = null
  private sessionId: string = crypto.randomUUID()
  private readonly budgetPath: string
  private readonly mcpServerPath: string
  private readonly systemPrompt: string
  private readonly model: string
  private readonly onEvent: (event: StreamEvent) => void
  private readonly onExit?: () => void
  private killed = false
  private interruptedMessages: readonly ChatMessage[] | null = null
  private finishedTurns: ContentBlock[] = []
  private currentTurnId: string | null = null
  private currentTurnBlocks: ContentBlock[] = []
  private inProgressTextIndex: number | null = null
  private toolUseRegistry: Map<string, string> = new Map()
  private cycleState: CycleState = { doneEmitted: false }

  constructor(opts: ClaudeCliAdapterOptions) {
    this.budgetPath = opts.budgetPath
    this.mcpServerPath = opts.mcpServerPath
    this.systemPrompt = opts.systemPrompt
    this.model = opts.model
    this.onEvent = opts.onEvent
    this.onExit = opts.onExit
  }

  get isAlive(): boolean {
    return this.child !== null
  }

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
      // The CLI's baked-in system prompt still describes these tools to the
      // model, which then narrates whether to use them. Disallowing silences it.
      "--disallowedTools",
      "TodoWrite,Task,Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch,NotebookEdit,KillBash,BashOutput",
      "--add-dir",
      this.budgetPath,
      "--setting-sources",
      "",
      // Empty model defers to the CLI's own default — omit the flag entirely.
      ...(this.model ? ["--model", this.model] : []),
      // Runaway-loop backstop; the CLI exits with `error_max_turns` when tripped.
      "--max-turns",
      String(SESSION_TOOL_CALL_BUDGET),
    ])

    command.stdout.on("data", (line: string) => {
      for (const event of parseStreamLine(line, this.toolUseRegistry, this.cycleState)) {
        // CLI is shutting itself down (e.g. --max-turns) — mark the teardown
        // deliberate so the close handler skips the unexpected-death onExit.
        if (event.type === "error") this.killed = true
        if (event.type === "tool-result") {
          this.onEvent(event)
          continue
        }
        // CLI emits already-clean error strings via the `result` line;
        // stamp the provider so the UI can render a consistent bubble.
        if (event.type === "error") {
          this.onEvent({ ...event, provider: "claude-cli" })
          continue
        }
        this.onEvent(this.accumulateCycleEvent(event))
      }
    })

    command.stderr.on("data", (line: string) => {
      console.debug("[claude-cli-stderr]", line)
    })

    command.on("close", () => {
      this.child = null
      if (!this.killed) {
        this.onExit?.()
      }
    })

    command.on("error", (error) => {
      // Symmetric with the stream-parsed error path: mark the teardown
      // deliberate so the subsequent `close` skips its onExit and doesn't
      // double-fire failRun, overwriting this specific message with the
      // generic "ended unexpectedly" text.
      this.killed = true
      this.onEvent({ type: "error", message: error, provider: "claude-cli" })
    })

    this.child = await command.spawn()
  }

  async send(content: MessageContent): Promise<void> {
    if (!this.child) {
      await this.spawn()
    }

    this.resetCycleAccumulator()
    this.cycleState.doneEmitted = false

    const payload = JSON.stringify({
      type: "user",
      message: { role: "user", content: this.applyRecoveryContext(content) },
    })

    await this.child!.write(payload + "\n")
  }

  markInterrupted(priorMessages: readonly ChatMessage[]): void {
    if (priorMessages.length === 0) {
      this.interruptedMessages = null
      return
    }
    this.interruptedMessages = priorMessages
  }

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
    return [
      { type: "text", text: recoveryPrefix },
      ...content,
    ]
  }

  async stop(): Promise<void> {
    this.killed = true
    if (this.child) {
      try {
        await this.child.kill()
      } catch {
        // already dead
      }
      this.child = null
    }
    // CLI can't reliably resume a session interrupted mid-turn — rotate.
    this.sessionId = crypto.randomUUID()
  }

  async restart(): Promise<void> {
    await this.kill()
    this.sessionId = crypto.randomUUID()
    this.interruptedMessages = null
  }

  async kill(): Promise<void> {
    this.killed = true
    if (this.child) {
      try {
        await this.child.kill()
      } catch {
        // already dead
      }
      this.child = null
    }
  }

  private accumulateCycleEvent(event: StreamEvent): StreamEvent {
    if (event.type === "done" || event.type === "error") {
      this.resetCycleAccumulator()
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
      if (block.type === "text" && this.inProgressTextIndex !== null) {
        this.currentTurnBlocks[this.inProgressTextIndex] = block
      } else {
        this.currentTurnBlocks.push(block)
        this.inProgressTextIndex =
          block.type === "text" ? this.currentTurnBlocks.length - 1 : null
      }
    }

    return {
      type: "content",
      blocks: [...this.finishedTurns, ...this.currentTurnBlocks],
    }
  }

  private resetCycleAccumulator(): void {
    this.finishedTurns = []
    this.currentTurnId = null
    this.currentTurnBlocks = []
    this.inProgressTextIndex = null
    this.toolUseRegistry.clear()
    // Do NOT reset cycleState.doneEmitted here — send() resets it per cycle.
    // Resetting on each in-cycle done/error would let the trailing `result`
    // line re-emit `done` after the assistant turn already did.
  }
}
