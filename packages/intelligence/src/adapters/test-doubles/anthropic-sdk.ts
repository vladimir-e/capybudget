import { vi } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"

interface FakeBlock {
  type: "text" | "tool_use"
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export interface AnthropicTurn {
  thinking?: Array<{ type: "thinking"; thinking: string; signature: string }>
  blocks?: Array<{ text: string } | { toolUse: { id: string; name: string; input: Record<string, unknown> } }>
  textDeltas?: string[]
  toolUses?: Array<{ id: string; name: string; input: Record<string, unknown> }>
  stop_reason: Anthropic.StopReason | null
  error?: Error
  /** Fails the stream with this error after its content has streamed. */
  failAfter?: Error
}

interface StreamStub {
  controller: AbortController
  abortSpy: ReturnType<typeof vi.fn>
}

type Handler = (...args: unknown[]) => void

const queue: AnthropicTurn[] = []
const calls: Array<Record<string, unknown>> = []
const abortSignals: AbortSignal[] = []
const streamStubs: StreamStub[] = []

function abortError(): Error {
  const err = new Error("Aborted")
  err.name = "AbortError"
  return err
}

const stream = vi.fn().mockImplementation((params, opts) => {
  calls.push({ ...params, messages: JSON.parse(JSON.stringify(params.messages)) })
  if (opts?.signal) abortSignals.push(opts.signal as AbortSignal)
  const turn = queue.shift()
  if (!turn) throw new Error("Test bug: no turn queued for messages.stream()")

  const handlers: Record<string, Handler[]> = {}
  const controller = new AbortController()
  const abortSpy = vi.fn()
  const originalAbort = controller.abort.bind(controller)
  controller.abort = ((reason?: unknown) => {
    abortSpy(reason)
    return originalAbort(reason as Error | undefined)
  }) as typeof controller.abort
  let ended = false
  const completed: FakeBlock[] = []
  let textAccum = ""

  function emit(event: string, ...args: unknown[]): void {
    if (ended) return
    const list = handlers[event]
    if (!list) return
    handlers[event] = list.filter((h) => !(h as { once?: boolean }).once)
    for (const h of list) h(...args)
  }

  function on(event: string, handler: Handler): typeof stub {
    ;(handlers[event] ??= []).push(handler)
    return stub
  }

  function once(event: string, handler: Handler): typeof stub {
    const wrapped = ((...args: unknown[]) => handler(...args)) as Handler & { once?: boolean }
    wrapped.once = true
    ;(handlers[event] ??= []).push(wrapped)
    return stub
  }

  const toContent = (blocks: FakeBlock[]) =>
    blocks.map((b) =>
      b.type === "text" ? { type: "text", text: b.text } : { type: "tool_use", id: b.id, name: b.name, input: b.input },
    )

  const stub = {
    on,
    once,
    controller,
    get currentMessage() {
      if (turn.error) return undefined
      const inProgress: FakeBlock[] = textAccum ? [{ type: "text", text: textAccum }] : []
      return { content: [...(turn.thinking ?? []), ...toContent([...completed, ...inProgress])], stop_reason: null }
    },
  }
  streamStubs.push({ controller, abortSpy })

  const sig = opts?.signal as AbortSignal | undefined
  const aborted = () => {
    if (!sig?.aborted && !controller.signal.aborted) return false
    emit("abort", abortError())
    ended = true
    return true
  }

  // Defer emits so the caller's `.on()` listeners are registered first.
  queueMicrotask(() => {
    try {
      if (turn.error) {
        emit("error", turn.error)
        ended = true
        return
      }
      for (const b of turn.blocks ?? []) {
        if (aborted()) return
        const block: FakeBlock = "text" in b ? { type: "text", text: b.text } : { type: "tool_use", ...b.toolUse }
        if (block.type === "text") emit("text", block.text)
        emit("contentBlock", block)
        completed.push(block)
      }
      if (turn.textDeltas) {
        for (const delta of turn.textDeltas) {
          if (aborted()) return
          textAccum += delta
          emit("text", delta)
        }
        if (textAccum) completed.push({ type: "text", text: textAccum })
        textAccum = ""
      }
      for (const tu of turn.toolUses ?? []) {
        if (aborted()) return
        const block: FakeBlock = { type: "tool_use", id: tu.id, name: tu.name, input: tu.input }
        emit("contentBlock", block)
        completed.push(block)
      }
      if (turn.failAfter) {
        emit("error", turn.failAfter)
        ended = true
        return
      }
      emit("message", { content: [...(turn.thinking ?? []), ...toContent(completed)], stop_reason: turn.stop_reason })
      ended = true
    } catch (err) {
      emit("error", err)
      ended = true
    }
  })

  return stub
})

export const anthropicSdk = {
  stream,
  queueTurn: (turn: AnthropicTurn) => queue.push(turn),
  lastStreamCall: () => calls[calls.length - 1],
  abortSignals,
  streamStubs,
  reset(): void {
    stream.mockClear()
    queue.length = 0
    abortSignals.length = 0
    streamStubs.length = 0
  },
}

export class FakeAnthropic {
  static APIConnectionError = class extends Error {}
  messages = { stream }
}

export function anthropicApiError(status: number, message: string): Error {
  return Object.assign(new Error(`${status} ${message}`), {
    status,
    error: { type: "error", error: { type: "invalid_request_error", message } },
  })
}
