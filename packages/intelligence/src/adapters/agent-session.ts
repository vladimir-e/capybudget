import { RENDER_FOLLOWUPS_TOOL_NAME } from "../render-map"
import { extractErrorMessage, isRateLimited, isRejectedRequest } from "../error-message"
import { runTool, REPLY_TOOL_CALL_BUDGET } from "../tools"
import {
  BUDGET_EXHAUSTED_RESULT,
  MAX_OUTPUT_TOKENS,
  STOPPED_MARKER,
  STOPPED_RESULT,
  TurnDisplay,
  clampedOutputCap,
  outcomeEvent,
} from "./agent-turn"
import type { LoopOutcome } from "./agent-turn"
import type { ApiAdapterOptions } from "../factory"
import type { CapySession } from "../session"
import type { FileAttachment, MessageContent, SessionProvider, StreamEvent } from "../types"

interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown> | Error
}

export interface ToolReply {
  id: string
  content: string
  isError: boolean
}

interface ToolRound {
  replies: ToolReply[]
  outcome: LoopOutcome | null
}

export abstract class AgentSession<Message> implements CapySession {
  protected readonly messages: Message[] = []
  private outputCap = MAX_OUTPUT_TOKENS
  private abortController: AbortController | null = null
  private alive = false
  private killed = false
  private sendSeq = 0
  private cancelledThrough = 0
  private turnEpoch = 0
  private toolCallCount = 0
  private replyStored = false
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

  get hasQueuedSend(): boolean {
    return this.sendSeq > Math.max(this.turnEpoch, this.cancelledThrough)
  }

  protected get stopped(): boolean {
    return this.killed || this.turnEpoch <= this.cancelledThrough
  }

  send(content: MessageContent, attachments: readonly FileAttachment[] = []): Promise<void> {
    if (this.killed) return Promise.resolve()
    const epoch = ++this.sendSeq
    return this.exclusive(() => this.runTurn(epoch, content, attachments))
  }

  async stop(): Promise<void> {
    this.cancelledThrough = this.sendSeq
    this.abortRequest()
    this.display?.settle()
  }

  async restart(): Promise<void> {
    this.cancelledThrough = this.sendSeq
    this.abortRequest()
    await this.exclusive(async () => {
      this.messages.length = 0
      this.alive = false
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
    try {
      return await request(this.outputCap)
    } catch (err) {
      const clamped = clampedOutputCap(err, this.outputCap)
      if (clamped === null) throw err
      const result = await request(clamped)
      this.outputCap = clamped
      return result
    }
  }

  protected storeReply(...items: Message[]): void {
    if (items.length === 0) return
    this.messages.push(...items)
    this.replyStored = true
  }

  protected markedIfStopped(text: string): string {
    return this.stopped ? text + STOPPED_MARKER : text
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
      if (this.toolCallCount > REPLY_TOOL_CALL_BUDGET) {
        budgetExhausted = true
        replies.push({ id: call.id, content: BUDGET_EXHAUSTED_RESULT, isError: true })
        continue
      }
      display.markStarted(call.id)
      const { content, ok } = await this.execute(call)
      display.markFinished(call.id, ok)
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

  private async runTurn(epoch: number, content: MessageContent, attachments: readonly FileAttachment[]): Promise<void> {
    if (this.killed || epoch <= this.cancelledThrough) return
    this.turnEpoch = epoch
    this.turnAttachments = attachments
    this.toolCallCount = 0
    this.replyStored = false
    const display = new TurnDisplay((blocks) => this.emit({ type: "content", blocks }))
    this.display = display
    const rollback = this.checkpoint()
    let end: StreamEvent | null
    try {
      this.appendUserTurn(content)
      this.alive = true
      end = outcomeEvent(await this.runAgenticLoop(display))
    } catch (err) {
      const rolledBack = !this.replyStored && !this.stopped && isRejectedRequest(err)
      if (rolledBack) rollback()
      end = failureEvent(err, rolledBack)
    } finally {
      this.turnAttachments = []
      this.closeRequest()
      this.display = null
    }
    if (!end || this.stopped) return
    display.settle()
    this.emit(end.type === "error" ? { ...end, provider: this.providerId } : end)
  }

  private checkpoint(): () => void {
    const length = this.messages.length
    const tail = this.messages[length - 1]
    return () => {
      this.messages.length = length
      if (length > 0) this.messages[length - 1] = tail
    }
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
    if (!this.killed || event.type === "tool-result") this.opts.onEvent(event)
  }
}

function failureEvent(err: unknown, rolledBack: boolean): StreamEvent {
  const { message, status } = extractErrorMessage(err)
  return {
    type: "error",
    message,
    status,
    ...(isRateLimited(err) ? { code: "rateLimited" as const } : {}),
    ...(rolledBack ? { rolledBack } : {}),
  }
}
