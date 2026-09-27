import { RENDER_FOLLOWUPS_TOOL_NAME } from "../render-map"
import { extractErrorMessage } from "../error-message"
import { runTool, SESSION_TOOL_CALL_BUDGET } from "../tools"
import {
  BUDGET_EXHAUSTED_RESULT,
  MAX_OUTPUT_TOKENS,
  STOPPED_RESULT,
  TurnDisplay,
  clampedOutputCap,
  outcomeEvent,
} from "./agent-turn"
import type { LoopOutcome } from "./agent-turn"
import type { ApiAdapterOptions } from "../factory"
import type { CapySession } from "../session"
import type { FileAttachment, MessageContent, SessionProvider, StreamEvent } from "../types"

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown> | Error
}

export interface ToolReply {
  id: string
  content: string
  isError: boolean
}

export interface ToolRound {
  replies: ToolReply[]
  outcome: LoopOutcome | null
}

export abstract class AgentSession<Message> implements CapySession {
  protected readonly messages: Message[] = []
  private outputCap = MAX_OUTPUT_TOKENS
  private abortController: AbortController | null = null
  private alive = false
  private killed = false
  private interrupted = false
  private toolCallCount = 0
  private idle: Promise<void> = Promise.resolve()
  private turnAttachments: readonly FileAttachment[] = []
  private display: TurnDisplay | null = null

  constructor(protected readonly opts: ApiAdapterOptions) {}

  protected abstract get providerId(): SessionProvider
  protected abstract appendUserTurn(content: MessageContent): void
  protected abstract runAgenticLoop(display: TurnDisplay): Promise<LoopOutcome>

  get isAlive(): boolean {
    return this.alive
  }

  protected get stopped(): boolean {
    return this.interrupted || this.killed
  }

  send(content: MessageContent, attachments: readonly FileAttachment[] = []): Promise<void> {
    if (this.killed) return Promise.resolve()
    return this.exclusive(() => this.runTurn(content, attachments))
  }

  async stop(): Promise<void> {
    this.interrupted = true
    this.abortRequest()
    this.display?.settle()
  }

  async restart(): Promise<void> {
    this.interrupted = true
    this.abortRequest()
    await this.exclusive(async () => {
      this.messages.length = 0
      this.alive = false
      this.toolCallCount = 0
    })
  }

  async kill(): Promise<void> {
    this.killed = true
    this.abortRequest()
    this.alive = false
  }

  protected openRequest(): AbortSignal {
    this.abortController = new AbortController()
    return this.abortController.signal
  }

  protected closeRequest(): void {
    this.abortController = null
  }

  protected async withOutputCap<T>(request: (maxTokens: number) => Promise<T>): Promise<T> {
    const cap = this.outputCap
    try {
      return await request(cap)
    } catch (err) {
      const clamped = clampedOutputCap(err, cap)
      if (clamped === null) throw err
      this.outputCap = clamped
      return request(clamped)
    }
  }

  protected async runToolCalls(calls: readonly ToolCall[], display: TurnDisplay): Promise<ToolRound> {
    const replies: ToolReply[] = []
    let budgetExhausted = false
    let terminal = false
    for (const call of calls) {
      if (this.stopped) {
        replies.push({ id: call.id, content: STOPPED_RESULT, isError: true })
        continue
      }
      this.toolCallCount++
      if (this.toolCallCount > SESSION_TOOL_CALL_BUDGET) {
        budgetExhausted = true
        replies.push({ id: call.id, content: BUDGET_EXHAUSTED_RESULT, isError: true })
        continue
      }
      display.markStarted(call.id)
      const { content, ok } = await this.execute(call)
      // A failed followups call is not terminal — the model sees the error and recovers.
      if (ok && call.name === RENDER_FOLLOWUPS_TOOL_NAME) terminal = true
      this.emit({ type: "tool-result", tool: call.name, id: call.id, ok })
      replies.push({ id: call.id, content, isError: !ok })
    }
    const outcome = this.stopped
      ? "stopped"
      : budgetExhausted
        ? "budgetExhausted"
        : terminal
          ? "done"
          : null
    return { replies, outcome }
  }

  private async runTurn(content: MessageContent, attachments: readonly FileAttachment[]): Promise<void> {
    if (this.killed) return
    this.interrupted = false
    this.turnAttachments = attachments
    const display = new TurnDisplay((blocks) => this.emit({ type: "content", blocks }))
    this.display = display
    let end: StreamEvent | null
    try {
      this.appendUserTurn(content)
      this.alive = true
      end = outcomeEvent(await this.runAgenticLoop(display))
    } catch (err) {
      const { message, status } = extractErrorMessage(err)
      end = { type: "error", message, status, provider: this.providerId }
    } finally {
      this.turnAttachments = []
      this.abortController = null
      this.display = null
    }
    if (!end || this.stopped) return
    display.settle()
    this.emit(end)
  }

  private async execute(call: ToolCall): Promise<{ content: string; ok: boolean }> {
    if (call.input instanceof Error) {
      return { content: `Error: invalid JSON arguments — ${call.input.message}`, ok: false }
    }
    try {
      const content = await runTool(call.name, call.input, {
        repo: this.opts.repo,
        fileAdapter: this.opts.fileAdapter,
        budgetPath: this.opts.budgetPath,
        currency: this.opts.currency,
        // Live read so a manual rate edit lands on this call's stamping, without rebuilding the session.
        currencies: this.opts.getCurrencies?.() ?? this.opts.currencies,
        attachments: [...this.turnAttachments],
        importSupported: this.opts.importSupported,
        pdfSupported: this.opts.pdfSupported,
      })
      return { content, ok: true }
    } catch (err) {
      return { content: `Error: ${err instanceof Error ? err.message : String(err)}`, ok: false }
    }
  }

  private exclusive(task: () => Promise<void>): Promise<void> {
    const run = this.idle.then(task)
    this.idle = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private abortRequest(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  private emit(event: StreamEvent): void {
    if (!this.killed) this.opts.onEvent(event)
  }
}
