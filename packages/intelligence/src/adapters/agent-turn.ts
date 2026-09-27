import { SESSION_TOOL_CALL_BUDGET } from "../tools"
import type { SessionErrorCode, StreamEvent } from "../types"

export const MAX_OUTPUT_TOKENS = 32000

export type LoopOutcome = "done" | SessionErrorCode

export const BUDGET_EXHAUSTED_RESULT = `Error: tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`
export const STOPPED_RESULT = "Error: not run — the user stopped the response before this call."
export const UNANSWERED_RESULT = "Error: not run — the response ended before this call could run."

export function cutOffOutcome(keptText: boolean, droppedCalls: boolean): LoopOutcome {
  return keptText && !droppedCalls ? "done" : "cutOff"
}

export function outcomeEvent(outcome: LoopOutcome): StreamEvent {
  switch (outcome) {
    case "done":
      return { type: "done" }
    case "cutOff":
      return {
        type: "error",
        code: "cutOff",
        message: "The response was cut off before Capy could reply. Try again.",
      }
    case "budgetExhausted":
      return {
        type: "error",
        code: "budgetExhausted",
        message: `Tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`,
      }
  }
}
