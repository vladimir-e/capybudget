import OpenAI from "openai"
import { AgentSession } from "./agent-session"
import { openAiClient } from "./clients"
import { UNANSWERED_RESULT, parseToolArguments, readToTerminal, toolCallBlock } from "./agent-turn"
import type { LoopOutcome, TurnDisplay } from "./agent-turn"
import type { MessageContent, SessionProvider } from "../types"
import { STRUCTURED_MAX_RETRIES, assertStructuredFinished, parseStructured, schemaBody } from "../structured"
import type { Ending, JsonSchema, StructuredCallOptions, StructuredMessage, StructuredSession } from "../structured"

type ModelResponse = OpenAI.Responses.Response
type InputItem = OpenAI.Responses.ResponseInputItem
type OutputItem = OpenAI.Responses.ResponseOutputItem
type ReplayedItem =
  | OpenAI.Responses.ResponseOutputMessage
  | OpenAI.Responses.ResponseFunctionToolCall
  | OpenAI.Responses.ResponseReasoningItem
type Includable = OpenAI.Responses.ResponseIncludable

interface StreamHandlers {
  text?: (event: OpenAI.Responses.ResponseTextDeltaEvent) => void
  itemDone?: (item: OutputItem) => void
}

const REASONING_REPLAY: Includable[] = ["reasoning.encrypted_content"]

async function readStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  on: StreamHandlers = {},
): Promise<ModelResponse | null> {
  let response: ModelResponse | null = null
  await readToTerminal(stream, (event) => {
    switch (event.type) {
      case "response.output_text.delta":
        on.text?.(event)
        return false
      case "response.output_item.done":
        on.itemDone?.(event.item)
        return false
      case "response.completed":
      case "response.incomplete":
        response = event.response
        return true
      case "response.failed":
        throw streamError(event.response.error?.message ?? "The response failed.", event.response.error?.code)
      case "error":
        throw streamError(event.message, event.code)
      default:
        return false
    }
  })
  return response
}

function streamError(message: string, code: string | null | undefined): Error {
  return Object.assign(new Error(message), { code })
}

function endingOf(response: ModelResponse | null): Ending {
  const refused = response?.output.some(
    (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
  )
  if (refused) return "refused"
  if (response?.status === "completed") return "finished"
  return response?.incomplete_details?.reason === "content_filter" ? "refused" : "cutOff"
}

function isReplayed(item: OutputItem): item is ReplayedItem {
  return item.type === "message" || item.type === "function_call" || item.type === "reasoning"
}

function rejectsReasoningReplay(err: unknown): boolean {
  const { status, param } = (err ?? {}) as { status?: unknown; param?: unknown }
  return status === 400 && param === "include"
}

function toResponsesUserContent(content: MessageContent): string | OpenAI.Responses.ResponseInputMessageContentList {
  if (typeof content === "string") return content
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "input_text", text: block.text }
    }
    if (block.type === "document") {
      return {
        type: "input_file",
        filename: block.filename ?? "document.pdf",
        file_data: `data:${block.source.media_type};base64,${block.source.data}`,
      }
    }
    return {
      type: "input_image",
      image_url: `data:${block.source.media_type};base64,${block.source.data}`,
      detail: "auto",
    }
  })
}

export class OpenAiSession extends AgentSession<InputItem> implements StructuredSession {
  private readonly client = openAiClient(this.opts.apiKey)
  private readonly tools: OpenAI.Responses.FunctionTool[] = this.toolDefinitions.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
    strict: false,
  }))
  private replayReasoning = true

  protected get providerId(): SessionProvider {
    return "openai"
  }

  protected isConnectionError(err: unknown): boolean {
    return err instanceof OpenAI.APIConnectionError
  }

  async structured<T = unknown>(
    messages: readonly StructuredMessage[],
    schema: JsonSchema,
    options?: StructuredCallOptions,
  ): Promise<T> {
    const params: Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, "max_output_tokens"> = {
      model: this.opts.model,
      instructions: this.opts.systemPrompt,
      store: false,
      input: messages.map((m) =>
        m.role === "assistant"
          ? { role: "assistant" as const, content: m.content }
          : { role: "user" as const, content: toResponsesUserContent(m.content) },
      ),
      text: {
        format: {
          type: "json_schema",
          name: "structured_output",
          schema: schemaBody(schema),
          strict: schema.strict === true,
        },
      },
    }

    return this.withStructuredRequest(options?.signal, async (signal) => {
      const requestOptions = { signal, maxRetries: STRUCTURED_MAX_RETRIES }
      if (!options?.onText) {
        const response = await this.withOutputCap((maxTokens) =>
          this.client.responses.create({ ...params, max_output_tokens: maxTokens }, requestOptions),
        )
        assertStructuredFinished(endingOf(response))
        return parseStructured<T>(response.output_text, schema)
      }

      const stream = await this.withOutputCap((maxTokens) =>
        this.client.responses.create({ ...params, max_output_tokens: maxTokens, stream: true }, requestOptions),
      )
      let text = ""
      const response = await readStream(stream, {
        text: (event) => {
          text += event.delta
          options.onText?.(text)
        },
      })
      assertStructuredFinished(endingOf(response))
      return parseStructured<T>(text, schema)
    })
  }

  protected async runAgenticLoop(display: TurnDisplay): Promise<LoopOutcome> {
    while (true) {
      if (this.stopped) return "stopped"

      display.beginIteration()
      const signal = this.openRequest()

      // The tools + instructions prefix must stay byte-identical across turns
      // for OpenAI's automatic prefix caching to hit — all per-turn context
      // rides in the user items of `this.messages`, never here.
      const stream = await this.withOutputCap((maxTokens) =>
        this.withReasoningReplay((include) =>
          this.client.responses.create(
            {
              model: this.opts.model,
              instructions: this.opts.systemPrompt,
              input: this.messages,
              tools: this.tools,
              store: false,
              include,
              stream: true,
              max_output_tokens: maxTokens,
            },
            { signal },
          ),
        ),
      )

      const leadingTexts = new Map<string, string>()
      let textItem: string | null = null
      let callSeen = false
      let response: ModelResponse | null = null

      try {
        response = await readStream(stream, {
          text: ({ item_id, delta }) => {
            if (item_id !== textItem) {
              display.endText()
              textItem = item_id
            }
            display.appendText(delta)
            if (!callSeen) leadingTexts.set(item_id, (leadingTexts.get(item_id) ?? "") + delta)
          },
          itemDone: (item) => {
            if (item.type !== "function_call") return
            callSeen = true
            const input = parseToolArguments(item.arguments)
            // Malformed args degrade to {} so the tool block still renders;
            // the JSON error surfaces in the tool result.
            display.addCall(item.call_id, toolCallBlock(item.name, input instanceof Error ? {} : input))
          },
        })
      } catch (err) {
        if (!this.stopped) {
          this.keepLeadingTexts(leadingTexts, display)
          throw err
        }
      }
      this.closeRequest()

      const ending = endingOf(response)
      if (ending !== "finished") {
        this.keepLeadingTexts(leadingTexts, display)
        return this.stopped ? "stopped" : ending
      }

      const output = (response?.output ?? []).filter(isReplayed)
      // A reasoning item replayed without the item it led to is rejected, so a
      // reasoning-only response leaves no trace in history.
      if (output.some((item) => item.type !== "reasoning")) this.storeReply(...output)

      const calls = output.flatMap((item) =>
        item.type === "function_call"
          ? [{ id: item.call_id, name: item.name, input: parseToolArguments(item.arguments) }]
          : [],
      )
      if (calls.length === 0) return "done"

      const round = await this.runToolCalls(calls, display)
      this.messages.push(
        ...round.replies.map((r) => ({ type: "function_call_output" as const, call_id: r.id, output: r.content })),
      )
      if (round.outcome) return round.outcome
    }
  }

  protected appendUserTurn(content: MessageContent): void {
    this.answerOpenToolCalls()
    this.messages.push({ role: "user", content: toResponsesUserContent(content) })
  }

  private keepLeadingTexts(streamed: ReadonlyMap<string, string>, display: TurnDisplay): void {
    const texts = [...streamed.values()].filter((t) => t.length > 0)
    display.replaceIteration(texts)
    this.storeReply(
      ...texts.map((text, i) => ({
        role: "assistant" as const,
        content: i === texts.length - 1 ? this.markedIfStopped(text) : text,
      })),
    )
  }

  private async withReasoningReplay<T>(request: (include: Includable[] | undefined) => Promise<T>): Promise<T> {
    if (!this.replayReasoning) return request(undefined)
    try {
      return await request(REASONING_REPLAY)
    } catch (err) {
      if (!rejectsReasoningReplay(err)) throw err
      this.replayReasoning = false
      return request(undefined)
    }
  }

  private answerOpenToolCalls(): void {
    const answered = new Set<string>()
    for (const item of this.messages) {
      if (item.type === "function_call_output") answered.add(item.call_id)
    }
    for (const item of [...this.messages]) {
      if (item.type !== "function_call" || answered.has(item.call_id)) continue
      this.messages.push({ type: "function_call_output", call_id: item.call_id, output: UNANSWERED_RESULT })
    }
  }
}
