import { buildRenderToolMap } from "../render-map"
import { extractErrorMessage } from "../error-message"
import { REPLY_TOOL_CALL_BUDGET } from "../tools"
import type { ContentBlock, SessionErrorCode, StreamEvent, ToolCallStatus } from "../types"

export const MAX_OUTPUT_TOKENS = 32000
export const FALLBACK_OUTPUT_TOKENS = 8192

export type LoopOutcome = "done" | "stopped" | Exclude<SessionErrorCode, "rateLimited" | "unreachable">

const CUT_OFF_MESSAGE = "reply cut off"
const REFUSED_MESSAGE = "reply refused"
const BUDGET_EXHAUSTED_MESSAGE = `Tool-call budget exhausted (${REPLY_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`

export const BUDGET_EXHAUSTED_RESULT = `Error: ${BUDGET_EXHAUSTED_MESSAGE}`
export const STOPPED_RESULT = "Error: not run — the user stopped the response before this call."
export const UNANSWERED_RESULT = "Error: not run — the response ended before this call could run."
export const STOPPED_MARKER = " [stopped by the user]"

export type Ending = Exclude<LoopOutcome, "stopped">

export function outcomeEvent(outcome: LoopOutcome): StreamEvent | null {
  return outcome === "stopped" ? null : endingEvent(outcome)
}

export function endingEvent(ending: Ending): StreamEvent {
  switch (ending) {
    case "done":
      return { type: "done" }
    case "cutOff":
      return { type: "error", code: "cutOff", message: CUT_OFF_MESSAGE }
    case "refused":
      return { type: "error", code: "refused", message: REFUSED_MESSAGE }
    case "budgetExhausted":
      return { type: "error", code: "budgetExhausted", message: BUDGET_EXHAUSTED_MESSAGE }
  }
}

const RENDER_TOOL_MAP = buildRenderToolMap()

export function toolCallBlock(name: string, input: Record<string, unknown>): ContentBlock {
  return RENDER_TOOL_MAP[name]?.(input) ?? { type: "tool-activity", tool: name, status: "pending" }
}

const CAP_PARAM = /max_(?:completion_|output_)?tokens/i
const CAP_TOO_LARGE = /too large|exceed|maximum|at most/i
const CONTEXT_LIMIT = /context/i
const STATUS_PREFIX = /^\d{3}\s+/
const COUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`
const CAP_LIMIT_SHAPES = [
  new RegExp(String.raw`max_tokens:\s*[\d,]+\s*>\s*${COUNT}`),
  new RegExp(String.raw`at most ${COUNT}(?: completion| output)? tokens`, "i"),
  new RegExp(String.raw`expected a value <= ${COUNT}`, "i"),
]
const MIN_PLAUSIBLE_CAP = 1024

export async function readToTerminal<T>(stream: AsyncIterable<T>, handle: (event: T) => boolean): Promise<void> {
  const events = stream[Symbol.asyncIterator]()
  try {
    for (let next = await events.next(); !next.done; next = await events.next()) {
      if (handle(next.value)) return
    }
  } finally {
    void drain(events)
  }
}

async function drain(events: AsyncIterator<unknown>): Promise<void> {
  try {
    let next = await events.next()
    while (!next.done) next = await events.next()
  } catch {
    return
  }
}

export function parseToolArguments(json: string): Record<string, unknown> | Error {
  try {
    return json ? JSON.parse(json) : {}
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

export function clampedOutputCap(err: unknown, cap: number): number | null {
  const { message: raw, status } = extractErrorMessage(err)
  if (status !== 400) return null
  const message = raw.replace(STATUS_PREFIX, "")
  if (!CAP_PARAM.test(message) || CONTEXT_LIMIT.test(message)) return null
  const limit = namedCapLimit(message)
  if (limit === null) return CAP_TOO_LARGE.test(message) && FALLBACK_OUTPUT_TOKENS < cap ? FALLBACK_OUTPUT_TOKENS : null
  return limit >= MIN_PLAUSIBLE_CAP && limit < cap ? limit : null
}

function namedCapLimit(message: string): number | null {
  for (const shape of CAP_LIMIT_SHAPES) {
    const match = shape.exec(message)
    if (match) return Number(match[1].replace(/,/g, ""))
  }
  return null
}

interface DisplayEntry {
  block: ContentBlock
  callId?: string
}

export class TurnDisplay {
  private entries: DisplayEntry[] = []
  private readonly started = new Set<string>()
  private iterationStart = 0
  private draft: number | null = null
  private draftText = ""
  private settled = false

  constructor(private readonly onChange: (blocks: ContentBlock[]) => void) {}

  beginIteration(): void {
    this.iterationStart = this.entries.length
    this.endText()
  }

  appendText(delta: string): void {
    this.draftText += delta
    const entry = { block: { type: "text" as const, content: this.draftText } }
    if (this.draft === null) {
      this.draft = this.entries.length
      this.entries.push(entry)
    } else {
      this.entries[this.draft] = entry
    }
    this.publish()
  }

  endText(): void {
    this.draft = null
    this.draftText = ""
  }

  addCall(id: string, block: ContentBlock): boolean {
    if (this.entries.some((e) => e.callId === id)) return false
    this.endText()
    this.entries.push({ block: block.type === "tool-activity" ? { ...block, id } : block, callId: id })
    this.publish()
    return true
  }

  replaceIteration(texts: readonly string[]): void {
    this.endText()
    this.entries.splice(
      this.iterationStart,
      Infinity,
      ...texts.map((content) => ({ block: { type: "text" as const, content } })),
    )
    this.publish()
  }

  markStarted(id: string): void {
    this.started.add(id)
    this.setStatus(id, "running")
  }

  markFinished(id: string, ok: boolean): void {
    this.setStatus(id, ok ? "done" : "failed")
  }

  settle(): void {
    if (this.settled) return
    const firstUnrun = this.entries.findIndex((e) => e.callId !== undefined && !this.started.has(e.callId))
    if (firstUnrun !== -1) {
      this.entries = this.entries.slice(0, firstUnrun)
      this.publish()
    }
    this.settled = true
  }

  private setStatus(id: string, status: ToolCallStatus): void {
    const i = this.entries.findIndex((e) => e.callId === id)
    const entry = this.entries[i]
    if (entry?.block.type !== "tool-activity") return
    this.entries[i] = { ...entry, block: { ...entry.block, status } }
    this.publish()
  }

  private publish(): void {
    if (this.settled) return
    this.onChange(this.entries.map((e) => e.block))
  }
}

export class TurnQueue {
  private seq = 0
  private current = 0
  private cancelledThrough = 0
  private idle: Promise<void> = Promise.resolve()

  get hasQueued(): boolean {
    return this.seq > Math.max(this.current, this.cancelledThrough)
  }

  get isCancelled(): boolean {
    return this.current <= this.cancelledThrough
  }

  enqueue(turn: () => Promise<void>): Promise<void> {
    const ticket = ++this.seq
    return this.exclusive(async () => {
      if (ticket <= this.cancelledThrough) return
      this.current = ticket
      await turn()
    })
  }

  cancelAll(): void {
    this.cancelledThrough = this.seq
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
