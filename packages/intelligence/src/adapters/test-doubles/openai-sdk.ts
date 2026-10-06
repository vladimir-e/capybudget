import { vi } from "vitest"

type Item = Record<string, unknown>
type Event = Record<string, unknown>

interface StreamRecord {
  controller: AbortController
  drained: boolean
}

function abortError(): Error {
  const err = new Error("Aborted")
  err.name = "AbortError"
  return err
}

/** Mirrors the SDK stream: leaving the iterator before the end aborts the request. */
function fakeStream(events: readonly unknown[], signal: AbortSignal | undefined, failAfter: Error | undefined, streams: StreamRecord[]) {
  const controller = new AbortController()
  const record = { controller, drained: false }
  streams.push(record)
  async function* iterate() {
    try {
      for (const event of events) {
        if (signal?.aborted || controller.signal.aborted) throw abortError()
        yield event
      }
      if (failAfter) throw failAfter
      record.drained = true
    } finally {
      if (!record.drained) controller.abort()
    }
  }
  return { [Symbol.asyncIterator]: iterate, controller }
}

export interface ResponsesCall {
  id: string
  name: string
  /** JSON argument fragments, one `function_call_arguments.delta` each. */
  argFragments?: string[]
}

export interface ResponsesTurn {
  reasoning?: { id: string; encrypted: string }
  textDeltas?: string[]
  /** A second message item, streamed after the calls. */
  trailingTextDeltas?: string[]
  refusalDeltas?: string[]
  calls?: ResponsesCall[]
  /** Null ends the stream without a terminal event. */
  status: "completed" | "incomplete" | null
  incompleteReason?: "max_output_tokens" | "content_filter"
  /** Rejects `create()` itself. */
  error?: Error
  /** Ends the stream with `response.failed` carrying this message. */
  failure?: string
  failureCode?: string
  /** Ends the stream with an `error` event carrying this message. */
  errorEvent?: string
  errorEventCode?: string
  /** Fails the stream with this error after its content events. */
  failAfter?: Error
  /** A text delta queued after the terminal event — must never be observed. */
  tailDelta?: string
}

export interface ResponsesStructuredReply {
  text: string
  status?: "completed" | "incomplete"
  incompleteReason?: "max_output_tokens" | "content_filter"
  refusal?: string
}

export interface ResponsesRequest {
  input: Item[]
  instructions?: string
  tools?: Item[]
  include?: string[]
  store?: boolean
  text?: unknown
  stream?: boolean
  max_output_tokens?: number
  previous_response_id?: string
}

function messageItem(id: string, content: Item[]): Item {
  return { type: "message", id, role: "assistant", status: "completed", content }
}

function outputText(output: Item[]): string {
  return output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content as Item[])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("")
}

function response(status: string, output: Item[], reason?: string): Item {
  return {
    object: "response",
    status,
    incomplete_details: reason ? { reason } : null,
    error: null,
    output,
    output_text: outputText(output),
  }
}

function responsesEvents(turn: ResponsesTurn): Event[] {
  const events: Event[] = []
  const output: Item[] = []
  const done = (item: Item) => {
    events.push({ type: "response.output_item.done", output_index: output.length, item })
    output.push(item)
  }
  const message = (id: string, deltas: string[]) => {
    events.push({ type: "response.output_item.added", output_index: output.length, item: messageItem(id, []) })
    for (const delta of deltas) {
      events.push({ type: "response.output_text.delta", item_id: id, output_index: output.length, content_index: 0, delta })
    }
    done(messageItem(id, [{ type: "output_text", text: deltas.join(""), annotations: [] }]))
  }

  if (turn.reasoning) {
    done({ type: "reasoning", id: turn.reasoning.id, summary: [], encrypted_content: turn.reasoning.encrypted })
  }
  if (turn.textDeltas) message("msg_1", turn.textDeltas)
  if (turn.refusalDeltas) {
    for (const delta of turn.refusalDeltas) {
      events.push({ type: "response.refusal.delta", item_id: "msg_r", output_index: output.length, content_index: 0, delta })
    }
    done(messageItem("msg_r", [{ type: "refusal", refusal: turn.refusalDeltas.join("") }]))
  }
  for (const call of turn.calls ?? []) {
    const item = { type: "function_call", id: `fc_${call.id}`, call_id: call.id, name: call.name, status: "in_progress" }
    events.push({ type: "response.output_item.added", output_index: output.length, item: { ...item, arguments: "" } })
    for (const delta of call.argFragments ?? []) {
      events.push({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: output.length, delta })
    }
    done({ ...item, status: "completed", arguments: (call.argFragments ?? []).join("") })
  }
  if (turn.trailingTextDeltas) message("msg_2", turn.trailingTextDeltas)

  if (turn.failure) {
    events.push({
      type: "response.failed",
      response: { ...response("failed", output), error: { code: turn.failureCode ?? "server_error", message: turn.failure } },
    })
  } else if (turn.errorEvent) {
    events.push({ type: "error", code: turn.errorEventCode ?? null, message: turn.errorEvent, param: null })
  } else if (turn.status) {
    events.push({ type: `response.${turn.status}`, response: response(turn.status, output, turn.incompleteReason) })
  }
  if (turn.tailDelta) {
    events.push({ type: "response.output_text.delta", item_id: "msg_tail", output_index: output.length, content_index: 0, delta: turn.tailDelta })
  }
  return events
}

const responsesQueue: ResponsesTurn[] = []
const responsesStructuredQueue: Array<ResponsesStructuredReply | { error: Error }> = []
const responsesCalls: ResponsesRequest[] = []
const responsesSignals: AbortSignal[] = []
const responsesStreams: StreamRecord[] = []

const responsesCreate = vi.fn().mockImplementation(async (params, opts) => {
  responsesCalls.push({ ...JSON.parse(JSON.stringify(params)), tools: params.tools })

  if (!params.stream) {
    const next = responsesStructuredQueue.shift()
    if (!next) throw new Error("Test bug: no structured response queued")
    if ("error" in next) throw next.error
    const content = next.refusal
      ? [{ type: "refusal", refusal: next.refusal }]
      : [{ type: "output_text", text: next.text, annotations: [] }]
    return response(next.status ?? "completed", [messageItem("msg_s", content)], next.incompleteReason)
  }

  if (opts?.signal) responsesSignals.push(opts.signal as AbortSignal)
  const turn = responsesQueue.shift()
  if (!turn) throw new Error("Test bug: no turn queued for responses.create()")
  if (turn.error) throw turn.error
  return fakeStream(responsesEvents(turn), opts?.signal, turn.failAfter, responsesStreams)
})

export const responsesSdk = {
  create: responsesCreate,
  queueTurn: (turn: ResponsesTurn) => responsesQueue.push(turn),
  queueStructured: (next: ResponsesStructuredReply | { error: Error }) => responsesStructuredQueue.push(next),
  lastCall: () => responsesCalls[responsesCalls.length - 1],
  allCalls: () => responsesCalls,
  abortSignals: responsesSignals,
  streams: responsesStreams,
  reset(): void {
    responsesCreate.mockClear()
    responsesQueue.length = 0
    responsesStructuredQueue.length = 0
    responsesSignals.length = 0
    responsesStreams.length = 0
  },
}

export function responsesApiError(
  status: number,
  message: string,
  param: string | null = "max_output_tokens",
  code: string | null = null,
): Error {
  return Object.assign(new Error(`${status} ${message}`), {
    status,
    param,
    error: { type: "invalid_request_error", code, message, param },
  })
}

export interface ChatToolCallDelta {
  /** Omitted to mimic Ollama's /v1 stream. */
  index?: number
  id?: string
  name?: string
  /** Sent whole in the announcement chunk, as Ollama does. */
  arguments?: string
  /** JSON argument fragments, emitted one per chunk to exercise the accumulator. */
  argFragments?: string[]
}

export interface ChatTurn {
  textDeltas?: string[]
  refusalDeltas?: string[]
  toolCallDeltas?: ChatToolCallDelta[]
  /** Null ends the stream without a finish chunk. */
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | null
  error?: Error
  /** Fails the stream with this error after its content chunks. */
  failAfter?: Error
  /** Extra chunk appended after finish_reason — must never be observed. */
  tailChunk?: { content: string }
}

export interface ChatStructuredReply {
  content: string
  finish_reason?: string
  refusal?: string
}

export interface ChatRequest {
  messages: unknown
  tools: unknown
  response_format?: unknown
  max_completion_tokens?: number
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return { choices: [{ delta, finish_reason: finishReason, index: 0 }] }
}

function chatChunks(turn: ChatTurn) {
  const chunks = [
    ...(turn.textDeltas ?? []).map((content) => chunk({ content })),
    ...(turn.refusalDeltas ?? []).map((refusal) => chunk({ refusal })),
  ]
  const calls = turn.toolCallDeltas ?? []
  const slot = (tc: ChatToolCallDelta) => (tc.index === undefined ? {} : { index: tc.index })
  for (const tc of calls) {
    chunks.push(
      chunk({ tool_calls: [{ ...slot(tc), id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments ?? "" } }] }),
    )
  }
  const fragmentRounds = Math.max(0, ...calls.map((tc) => tc.argFragments?.length ?? 0))
  for (let i = 0; i < fragmentRounds; i++) {
    for (const tc of calls) {
      const fragment = tc.argFragments?.[i]
      if (fragment !== undefined) chunks.push(chunk({ tool_calls: [{ ...slot(tc), function: { arguments: fragment } }] }))
    }
  }
  if (turn.finish_reason) chunks.push(chunk({}, turn.finish_reason))
  if (turn.tailChunk) chunks.push(chunk({ content: turn.tailChunk.content }))
  return chunks
}

const chatQueue: ChatTurn[] = []
const chatStructuredQueue: Array<ChatStructuredReply | { error: Error }> = []
const chatCalls: ChatRequest[] = []
const chatSignals: AbortSignal[] = []
const chatStreams: StreamRecord[] = []

const chatCreate = vi.fn().mockImplementation(async (params, opts) => {
  chatCalls.push({
    messages: JSON.parse(JSON.stringify(params.messages)),
    tools: params.tools,
    ...(params.stream ? {} : { response_format: params.response_format }),
    max_completion_tokens: params.max_completion_tokens,
  })

  if (!params.stream) {
    const next = chatStructuredQueue.shift()
    if (!next) throw new Error("Test bug: no structured completion queued")
    if ("error" in next) throw next.error
    return {
      choices: [
        {
          message: { role: "assistant", content: next.content, refusal: next.refusal ?? null },
          finish_reason: next.finish_reason ?? "stop",
        },
      ],
    }
  }

  if (opts?.signal) chatSignals.push(opts.signal as AbortSignal)
  const turn = chatQueue.shift()
  if (!turn) throw new Error("Test bug: no turn queued for chat.completions.create()")
  if (turn.error) throw turn.error
  return fakeStream(chatChunks(turn), opts?.signal, turn.failAfter, chatStreams)
})

export const chatSdk = {
  create: chatCreate,
  queueTurn: (turn: ChatTurn) => chatQueue.push(turn),
  queueStructured: (next: ChatStructuredReply | { error: Error }) => chatStructuredQueue.push(next),
  lastCall: () => chatCalls[chatCalls.length - 1],
  allCalls: () => chatCalls,
  abortSignals: chatSignals,
  streams: chatStreams,
  reset(): void {
    chatCreate.mockClear()
    chatQueue.length = 0
    chatStructuredQueue.length = 0
    chatSignals.length = 0
    chatStreams.length = 0
  },
}

export function chatApiError(status: number, message: string): Error {
  return Object.assign(new Error(`${status} ${message}`), {
    status,
    error: { type: "invalid_request_error", code: null, message, param: "max_tokens" },
  })
}

export const openAiClientConfigs: Array<{ apiKey: string; baseURL?: string }> = []

export class FakeOpenAI {
  static APIConnectionError = class extends Error {}
  responses = { create: responsesCreate }
  chat = { completions: { create: chatCreate } }
  constructor(config: { apiKey: string; baseURL?: string }) {
    openAiClientConfigs.push(config)
  }
}
