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
import { CycleAccumulator } from "./claude-cli-accumulator"
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
  private readonly accumulator = new CycleAccumulator()
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
    ], {
      // Undocumented CLI switch: since 2.1.69 the CLI defers MCP tool
      // schemas behind a ToolSearch lookup, and the model sometimes calls
      // render tools blind with invented payloads. Disabling deferral
      // loads all mcp__capy__ schemas upfront.
      env: { ENABLE_TOOL_SEARCH: "false" },
    })

    command.stdout.on("data", (line: string) => {
      for (const event of parseStreamLine(line, this.toolUseRegistry, this.cycleState)) {
        // CLI is shutting itself down (e.g. --max-turns) — mark the teardown
        // deliberate so the close handler skips the unexpected-death onExit.
        if (event.type === "error") this.killed = true
        if (event.type === "tool-result") {
          this.onEvent(event)
          continue
        }
        // Turn over — a reused tool_use id in the next turn must not
        // false-hit the registry.
        if (event.type === "done") this.toolUseRegistry.clear()
        const out = this.accumulator.accumulate(event)
        // CLI emits already-clean error strings via the `result` line;
        // stamp the provider so the UI can render a consistent bubble.
        this.onEvent(out.type === "error" ? { ...out, provider: "claude-cli" } : out)
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
      this.onEvent({ type: "error", message: error, provider: "claude-cli" })
    })

    this.child = await command.spawn()
  }

  async send(content: MessageContent): Promise<void> {
    if (!this.child) {
      await this.spawn()
    }

    this.accumulator.reset()
    this.toolUseRegistry.clear()
    // doneEmitted is only re-armed here, per send-cycle — re-arming on each
    // in-cycle done/error would let the trailing `result` line re-emit
    // `done` after the assistant turn already did.
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
}
