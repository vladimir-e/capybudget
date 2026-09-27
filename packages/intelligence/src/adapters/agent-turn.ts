import { buildRenderToolMap } from "../render-map"
import { extractErrorMessage } from "../error-message"
import { SESSION_TOOL_CALL_BUDGET } from "../tools"
import type { ContentBlock, SessionErrorCode, StreamEvent } from "../types"

export const MAX_OUTPUT_TOKENS = 32000
export const FALLBACK_OUTPUT_TOKENS = 8192

export type LoopOutcome = "done" | "stopped" | SessionErrorCode

const CUT_OFF_MESSAGE = "Capy's reply was cut off before it finished. Try again, or ask for less at once."
const BUDGET_EXHAUSTED_MESSAGE = `Tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`

export const BUDGET_EXHAUSTED_RESULT = `Error: ${BUDGET_EXHAUSTED_MESSAGE}`
export const STOPPED_RESULT = "Error: not run — the user stopped the response before this call."
export const UNANSWERED_RESULT = "Error: not run — the response ended before this call could run."

export class CutOffError extends Error {
  constructor() {
    super(CUT_OFF_MESSAGE)
    this.name = "CutOffError"
  }
}

export function cutOffOutcome(keptText: boolean, droppedCalls: boolean): LoopOutcome {
  return keptText && !droppedCalls ? "done" : "cutOff"
}

export function outcomeEvent(outcome: LoopOutcome): StreamEvent | null {
  switch (outcome) {
    case "done":
      return { type: "done" }
    case "stopped":
      return null
    case "cutOff":
      return { type: "error", code: "cutOff", message: CUT_OFF_MESSAGE }
    case "budgetExhausted":
      return { type: "error", code: "budgetExhausted", message: BUDGET_EXHAUSTED_MESSAGE }
  }
}

const RENDER_TOOL_MAP = buildRenderToolMap()

export function toolCallBlock(name: string, input: Record<string, unknown>): ContentBlock {
  return RENDER_TOOL_MAP[name]?.(input) ?? { type: "tool-activity", tool: name }
}

const OUTPUT_CAP_PARAM = /max_(?:completion_|output_)?tokens/i
const STANDALONE_NUMBER = /(?<![\w.-])\d+(?![\w-])/g

export function clampedOutputCap(err: unknown, cap: number): number | null {
  const { message, status } = extractErrorMessage(err)
  if (status !== 400 || !OUTPUT_CAP_PARAM.test(message)) return null
  const limits = (message.match(STANDALONE_NUMBER) ?? []).map(Number).filter((n) => n > 0 && n < cap)
  const clamped = limits.length > 0 ? Math.max(...limits) : FALLBACK_OUTPUT_TOKENS
  return clamped < cap ? clamped : null
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

  addCall(id: string, block: ContentBlock): void {
    this.endText()
    this.entries.push({ block, callId: id })
    this.publish()
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
  }

  settle(): void {
    if (this.settled) return
    const ran = this.entries.filter((e) => e.callId === undefined || this.started.has(e.callId))
    if (ran.length !== this.entries.length) {
      this.entries = ran
      this.publish()
    }
    this.settled = true
  }

  private publish(): void {
    if (this.settled) return
    this.onChange(this.entries.map((e) => e.block))
  }
}
