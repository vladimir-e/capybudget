import { extractErrorMessage } from "../../error-message"
import { REPLY_TOOL_CALL_BUDGET } from "../../tools"
import type { ClaudeCliAdapterOptions } from "../../factory"
import type { CapySession } from "../../session"
import type { ChatMessage, MessageContent, StreamEvent } from "../../types"
import { TurnQueue } from "../agent-turn"
import { CliTurn } from "./cli-turn"
import { serializeConversation } from "./serialize-conversation"

export interface ClaudeCliProcess {
  write(data: string): Promise<void>
  kill(): Promise<void>
}

export interface ClaudeCliProcessEvents {
  line(line: string): void
  stderr(line: string): void
  exit(code: number | null): void
}

export interface ClaudeCliSpawnOptions {
  cwd: string
  env: Readonly<Record<string, string>>
}

export interface ClaudeCliHost {
  readonly projectRoot: string
  spawn(args: readonly string[], options: ClaudeCliSpawnOptions, events: ClaudeCliProcessEvents): Promise<ClaudeCliProcess>
}

const RECOVERY_CONTEXT_MAX_CHARS = 5000
const EXIT_REASON_LINES = 3
const RESULT_GRACE_MS = 30_000
const HARMLESS_STDERR = [/claude\.ai connectors are disabled/, /DeprecationWarning/, /--trace-deprecation/]
const MCP_SERVER_NAME = "capy"

export class ClaudeCliSession implements CapySession {
  private child: ClaudeCliProcess | null = null
  private generation = 0
  private killed = false
  private readonly queue = new TurnQueue()
  private turn: { cli: CliTurn; end: () => void } | null = null
  private interruptedMessages: readonly ChatMessage[] | null = null
  private stderrTail: string[] = []
  private resultWatchdog: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly opts: ClaudeCliAdapterOptions,
    private readonly host: ClaudeCliHost,
  ) {}

  get hasQueuedSend(): boolean {
    return this.queue.hasQueued
  }

  send(content: MessageContent): Promise<void> {
    if (this.killed) return Promise.resolve()
    return this.queue.enqueue(() => this.runTurn(content))
  }

  markInterrupted(priorMessages: readonly ChatMessage[]): void {
    this.interruptedMessages = priorMessages.length > 0 ? priorMessages : null
  }

  async stop(): Promise<void> {
    this.queue.cancelAll()
    await this.endProcess()
  }

  async kill(): Promise<void> {
    this.killed = true
    await this.endProcess()
  }

  private get cancelled(): boolean {
    return this.killed || this.queue.isCancelled
  }

  private async runTurn(content: MessageContent): Promise<void> {
    if (this.killed) return
    const ended = new Promise<void>((end) => {
      this.turn = { cli: new CliTurn((event) => this.emit(event)), end }
    })
    let child: ClaudeCliProcess | null
    try {
      child = this.child ?? (await this.spawn())
    } catch (err) {
      this.finishTurn()
      if (!this.cancelled) this.emit({ type: "error", message: extractErrorMessage(err).message })
      return
    }
    if (!child || this.cancelled) return this.finishTurn()
    const prior = this.interruptedMessages
    try {
      await child.write(JSON.stringify({ type: "user", message: { role: "user", content: this.withRecovery(content) } }) + "\n")
    } catch {
      if (this.cancelled) return this.finishTurn()
      this.interruptedMessages ??= prior
      this.abandonProcess()
    }
    await ended
  }

  private async spawn(): Promise<ClaudeCliProcess | null> {
    const generation = ++this.generation
    this.stderrTail = []
    const options = { cwd: this.opts.budgetPath, env: { ENABLE_TOOL_SEARCH: "false" } }
    const child = await this.host.spawn(this.args(), options, {
      line: (line) => {
        if (generation === this.generation) this.receive(line)
      },
      stderr: (line) => {
        if (generation === this.generation) this.noteStderr(line)
      },
      exit: (code) => this.exited(generation, code),
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
          command: `${root}/node_modules/.bin/tsx`,
          args: [`${root}/${mcpServerPath}`],
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
      "--restricted",
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
    if (turn.cli.isComplete) this.finishTurn()
    else if (turn.cli.hasEnded) this.awaitResult()
  }

  private awaitResult(): void {
    if (this.resultWatchdog) clearTimeout(this.resultWatchdog)
    this.resultWatchdog = setTimeout(() => {
      this.resultWatchdog = null
      this.abandonProcess()
    }, RESULT_GRACE_MS)
  }

  private abandonProcess(): void {
    const child = this.child
    this.exited(this.generation, null)
    void child?.kill().catch(() => undefined)
  }

  private exited(generation: number, code: number | null): void {
    if (generation !== this.generation) return
    this.generation++
    this.child = null
    const reported = this.turn?.cli.hasEnded ?? false
    this.finishTurn()
    this.opts.onExit?.(code === 0 ? undefined : this.stderrTail.join("\n") || undefined, reported)
  }

  private noteStderr(line: string): void {
    const trimmed = line.trim()
    if (trimmed && !HARMLESS_STDERR.some((pattern) => pattern.test(trimmed))) this.stderrTail = [...this.stderrTail, trimmed].slice(-EXIT_REASON_LINES)
  }

  private async endProcess(): Promise<void> {
    this.generation++
    const child = this.child
    this.child = null
    this.finishTurn()
    await child?.kill().catch(() => undefined)
  }

  private finishTurn(): void {
    if (this.resultWatchdog) clearTimeout(this.resultWatchdog)
    this.resultWatchdog = null
    const turn = this.turn
    this.turn = null
    turn?.end()
  }

  private withRecovery(content: MessageContent): MessageContent {
    const prior = this.interruptedMessages
    if (!prior) return content
    this.interruptedMessages = null
    const prefix = [
      "[Previous conversation — the session was interrupted]",
      serializeConversation(prior, RECOVERY_CONTEXT_MAX_CHARS),
      "[This is a fresh session. The user may want to continue the conversation — pick up where you left off or ask for clarification if needed.]",
      "",
    ].join("\n")
    return typeof content === "string" ? `${prefix}\n${content}` : [{ type: "text", text: prefix }, ...content]
  }

  private emit(event: StreamEvent): void {
    if (this.killed) return
    this.opts.onEvent(event.type === "error" ? { ...event, provider: "claude-cli" } : event)
  }
}
