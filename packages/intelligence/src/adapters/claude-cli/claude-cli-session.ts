import { extractErrorMessage } from "../../error-message"
import { REPLY_TOOL_CALL_BUDGET } from "../../tools"
import type { ClaudeCliAdapterOptions } from "../../factory"
import type { CapySession } from "../../session"
import type { ChatMessage, MessageContent, StreamEvent } from "../../types"
import { CliTurn } from "./cli-turn"
import { serializeConversation } from "./serialize-conversation"

export interface ClaudeCliProcess {
  write(data: string): Promise<void>
  kill(): Promise<void>
}

export interface ClaudeCliProcessEvents {
  line(line: string): void
  exit(): void
}

export interface ClaudeCliHost {
  readonly projectRoot: string
  spawn(args: readonly string[], env: Readonly<Record<string, string>>, events: ClaudeCliProcessEvents): Promise<ClaudeCliProcess>
}

const RECOVERY_CONTEXT_MAX_CHARS = 5000
const MCP_SERVER_NAME = "capy"

export class ClaudeCliSession implements CapySession {
  private child: ClaudeCliProcess | null = null
  private generation = 0
  private killed = false
  private sendSeq = 0
  private cancelledThrough = 0
  private turnEpoch = 0
  private idle: Promise<void> = Promise.resolve()
  private turn: { cli: CliTurn; end: () => void } | null = null
  private interruptedMessages: readonly ChatMessage[] | null = null

  constructor(
    private readonly opts: ClaudeCliAdapterOptions,
    private readonly host: ClaudeCliHost,
  ) {}

  get isAlive(): boolean {
    return this.child !== null
  }

  get hasQueuedSend(): boolean {
    return this.sendSeq > Math.max(this.turnEpoch, this.cancelledThrough)
  }

  send(content: MessageContent): Promise<void> {
    if (this.killed) return Promise.resolve()
    const epoch = ++this.sendSeq
    return this.exclusive(() => this.runTurn(epoch, content))
  }

  markInterrupted(priorMessages: readonly ChatMessage[]): void {
    this.interruptedMessages = priorMessages.length > 0 ? priorMessages : null
  }

  async stop(): Promise<void> {
    this.cancelledThrough = this.sendSeq
    await this.endProcess()
  }

  async restart(): Promise<void> {
    this.cancelledThrough = this.sendSeq
    this.interruptedMessages = null
    await this.endProcess()
  }

  async kill(): Promise<void> {
    this.killed = true
    await this.endProcess()
  }

  private get cancelled(): boolean {
    return this.killed || this.turnEpoch <= this.cancelledThrough
  }

  private async runTurn(epoch: number, content: MessageContent): Promise<void> {
    if (this.killed || epoch <= this.cancelledThrough) return
    this.turnEpoch = epoch
    const ended = new Promise<void>((end) => {
      this.turn = { cli: new CliTurn((event) => this.emit(event)), end }
    })
    try {
      const child = this.child ?? (await this.spawn())
      if (!child || this.cancelled) return this.finishTurn()
      await child.write(JSON.stringify({ type: "user", message: { role: "user", content: this.withRecovery(content) } }) + "\n")
    } catch (err) {
      if (this.cancelled) return this.finishTurn()
      await this.endProcess()
      this.emit({ type: "error", message: extractErrorMessage(err).message })
      return
    }
    await ended
  }

  private async spawn(): Promise<ClaudeCliProcess | null> {
    const generation = ++this.generation
    const child = await this.host.spawn(this.args(), { ENABLE_TOOL_SEARCH: "false" }, {
      line: (line) => {
        if (generation === this.generation) this.receive(line)
      },
      exit: () => this.exited(generation),
    })
    if (generation !== this.generation) {
      await child.kill().catch(() => undefined)
      return null
    }
    this.child = child
    return child
  }

  private args(): string[] {
    const { budgetPath, mcpServerPath, systemPrompt, model } = this.opts
    const root = this.host.projectRoot
    const mcpConfig = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          command: "npx",
          args: ["tsx", `${root}/${mcpServerPath}`],
          cwd: root,
          env: { BUDGET_PATH: budgetPath },
        },
      },
    }
    return [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--system-prompt", systemPrompt,
      "--mcp-config", JSON.stringify(mcpConfig),
      "--strict-mcp-config",
      "--tools", "Read",
      "--allowedTools", `mcp__${MCP_SERVER_NAME}__*,Read`,
      "--add-dir", budgetPath,
      "--setting-sources", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      ...(model ? ["--model", model] : []),
      "--max-turns", String(REPLY_TOOL_CALL_BUDGET),
    ]
  }

  private receive(line: string): void {
    const turn = this.turn
    if (!turn) return
    turn.cli.feed(line)
    if (turn.cli.isOver) this.finishTurn()
  }

  private exited(generation: number): void {
    if (generation !== this.generation) return
    this.generation++
    this.child = null
    this.finishTurn()
    this.opts.onExit?.()
  }

  private async endProcess(): Promise<void> {
    this.generation++
    const child = this.child
    this.child = null
    this.finishTurn()
    await child?.kill().catch(() => undefined)
  }

  private finishTurn(): void {
    const turn = this.turn
    this.turn = null
    turn?.end()
  }

  private withRecovery(content: MessageContent): MessageContent {
    const prior = this.interruptedMessages
    if (!prior) return content
    this.interruptedMessages = null
    const prefix = [
      "[Previous conversation — session was interrupted by user]",
      serializeConversation(prior, RECOVERY_CONTEXT_MAX_CHARS),
      "[Session was interrupted. This is a fresh session. The user may want to continue the conversation — pick up where you left off or ask for clarification if needed.]",
      "",
    ].join("\n")
    return typeof content === "string" ? `${prefix}\n${content}` : [{ type: "text", text: prefix }, ...content]
  }

  private emit(event: StreamEvent): void {
    if (this.killed) return
    this.opts.onEvent(event.type === "error" ? { ...event, provider: "claude-cli" } : event)
  }

  private exclusive(task: () => Promise<void>): Promise<void> {
    const run = this.idle.then(task)
    this.idle = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
