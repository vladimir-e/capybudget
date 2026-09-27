import OpenAI from "openai"
import { getToolDefinitions } from "../tools"
import { AgentSession } from "./agent-session"
import { UNANSWERED_RESULT, toolCallBlock } from "./agent-turn"
import type { LoopOutcome, TurnDisplay } from "./agent-turn"
import type { ApiAdapterOptions } from "../factory"
import type { MessageContent, SessionProvider } from "../types"
import { CutOffError, parseStructured, schemaBody } from "../structured"
import type { JsonSchema, StructuredCallOptions, StructuredMessage, StructuredSession } from "../structured"

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

// Ollama reports "stop" alongside tool calls.
function finished(reason: string | null | undefined): boolean {
  return reason === "tool_calls" || reason === "stop"
}

function toOpenAiUserContent(
  content: MessageContent,
): OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] {
  if (typeof content === "string") return content
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text }
    }
    if (block.type === "document") {
      return {
        type: "file",
        file: {
          filename: block.filename ?? "document.pdf",
          file_data: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      }
    }
    return {
      type: "image_url",
      image_url: {
        url: `data:${block.source.media_type};base64,${block.source.data}`,
      },
    }
  })
}

interface ToolCallAccumulator {
  id: string
  name: string
  argsString: string
  parsed?: Record<string, unknown> | Error
}

/** Ollama's stream may omit `index`: a new `id` opens a call, anything else
 *  continues the last one. */
function toolSlot(
  tc: { index?: number; id?: string },
  accs: Map<number, ToolCallAccumulator>,
  lastSlot: number,
): number {
  if (typeof tc.index === "number") return tc.index
  if (tc.id) {
    for (const [slot, acc] of accs) if (acc.id === tc.id) return slot
    return accs.size === 0 ? 0 : Math.max(...accs.keys()) + 1
  }
  return Math.max(lastSlot, 0)
}

function finalizeToolArgs(acc: ToolCallAccumulator): Record<string, unknown> | Error {
  if (acc.parsed !== undefined) return acc.parsed
  let result: Record<string, unknown> | Error
  try {
    result = acc.argsString ? JSON.parse(acc.argsString) : {}
  } catch (err) {
    result = err instanceof Error ? err : new Error(String(err))
  }
  acc.parsed = result
  return result
}

export class OpenAiSession extends AgentSession<ChatMessage> implements StructuredSession {
  private readonly client: OpenAI
  private readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[]

  constructor(opts: ApiAdapterOptions) {
    super(opts)
    this.tools = getToolDefinitions({ pdfSupported: opts.pdfSupported }).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }))
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      // Tauri webview — key lives on disk, not bundled into a public app.
      dangerouslyAllowBrowser: true,
    })
  }

  protected get providerId(): SessionProvider {
    return "openai"
  }

  async structured<T = unknown>(
    messages: readonly StructuredMessage[],
    schema: JsonSchema,
    options?: StructuredCallOptions,
  ): Promise<T> {
    const requestMessages: ChatMessage[] = [
      { role: "system", content: this.opts.systemPrompt },
      ...messages.map((m) =>
        m.role === "assistant"
          ? { role: "assistant" as const, content: m.content }
          : { role: "user" as const, content: toOpenAiUserContent(m.content) },
      ),
    ]

    // `strict` is our own marker on the schema, not a JSON-schema keyword;
    // it rides on the json_schema wrapper, not inside the schema OpenAI sees.
    const params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "max_completion_tokens"> = {
      model: this.opts.model,
      messages: requestMessages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: schemaBody(schema),
          ...(schema.strict === true ? { strict: true } : {}),
        },
      },
    }

    if (!options?.onText) {
      const completion = await this.withOutputCap((maxTokens) =>
        this.client.chat.completions.create({ ...params, max_completion_tokens: maxTokens }),
      )
      const choice = completion.choices[0]
      if (!finished(choice?.finish_reason)) throw new CutOffError()
      return parseStructured<T>(choice.message.content ?? "", schema)
    }

    const stream = await this.withOutputCap((maxTokens) =>
      this.client.chat.completions.create({ ...params, max_completion_tokens: maxTokens, stream: true }),
    )
    let text = ""
    let finishReason: string | null = null
    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue
      if (typeof choice.delta?.content === "string" && choice.delta.content.length > 0) {
        text += choice.delta.content
        options.onText(text)
      }
      // Same early break as the agentic loop — the terminal usage chunk
      // isn't needed and `return()` lets the SDK clean up.
      if (choice.finish_reason) {
        finishReason = choice.finish_reason
        break
      }
    }
    if (!finished(finishReason)) throw new CutOffError()
    return parseStructured<T>(text, schema)
  }

  protected async runAgenticLoop(display: TurnDisplay): Promise<LoopOutcome> {
    while (true) {
      if (this.stopped) return "stopped"

      display.beginIteration()
      const signal = this.openRequest()

      // System prompt kept out of `this.messages` so restart() resets cleanly.
      // The tools + system prefix must stay byte-identical across turns for
      // OpenAI's automatic prefix caching to hit — `systemPrompt` is immutable
      // for the session's life and all per-turn context (budget snapshot, date,
      // attachments) rides in the user messages of `this.messages`, never here.
      const requestMessages: ChatMessage[] = [
        { role: "system", content: this.opts.systemPrompt },
        ...this.messages,
      ]

      const stream = await this.withOutputCap((maxTokens) =>
        this.client.chat.completions.create(
          {
            model: this.opts.model,
            messages: requestMessages,
            tools: this.tools,
            stream: true,
            // GPT-5 and the o-series reject `max_tokens`; `max_completion_tokens`
            // works across all current chat models.
            max_completion_tokens: maxTokens,
          },
          { signal },
        ),
      )

      let text = ""
      const toolAccs = new Map<number, ToolCallAccumulator>()
      let finishReason: string | null = null
      let lastSlot = -1

      try {
        for await (const chunk of stream) {
          const choice = chunk.choices[0]
          if (!choice) continue
          const delta = choice.delta

          if (typeof delta.content === "string" && delta.content.length > 0) {
            text += delta.content
            display.appendText(delta.content)
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = toolSlot(tc, toolAccs, lastSlot)
              lastSlot = idx
              let acc = toolAccs.get(idx)
              if (!acc) {
                acc = { id: "", name: "", argsString: "" }
                toolAccs.set(idx, acc)
              }
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name = tc.function.name
              if (tc.function?.arguments) acc.argsString += tc.function.arguments
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason
            // OpenAI keeps the stream open for a terminal usage chunk Capy
            // doesn't display. Breaking out of `for await` lets V8 invoke the
            // iterator's `return()`, which the SDK hooks for cleanup — no
            // explicit abort needed, and symmetric with the Anthropic adapter.
            break
          }
        }
      } catch (err) {
        if (!this.stopped) throw err
      }
      this.closeRequest()

      if (!finished(finishReason)) {
        if (text.length > 0) this.messages.push({ role: "assistant", content: this.markedIfStopped(text) })
        return finishReason === "content_filter" ? "refused" : "cutOff"
      }

      const accs = [...toolAccs.keys()].sort((a, b) => a - b).map((idx) => toolAccs.get(idx)!)
      const calls = accs.map((acc) => ({ id: acc.id, name: acc.name, input: finalizeToolArgs(acc) }))
      for (const call of calls) {
        // Malformed args degrade to {} so the tool block still renders;
        // the JSON error surfaces in the tool result.
        display.addCall(call.id, toolCallBlock(call.name, call.input instanceof Error ? {} : call.input))
      }

      // Only persist a turn that carries text or tool calls. An empty terminal
      // completion stored as `{content: null}` with no tool_calls is invalid to
      // OpenAI, and history replays on every send — so one poisons the whole
      // session. Tool-call turns keep null content (canonical).
      if (text.length > 0 || calls.length > 0) {
        const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: text.length > 0 ? text : null,
        }
        if (calls.length > 0) {
          assistantMessage.tool_calls = accs.map((acc) => ({
            id: acc.id,
            type: "function",
            function: { name: acc.name, arguments: acc.argsString },
          }))
        }
        this.messages.push(assistantMessage)
      }

      // No calls = terminal: re-sending unchanged history spins.
      if (calls.length === 0) return "done"

      const round = await this.runToolCalls(calls, display)
      this.messages.push(
        ...round.replies.map((r) => ({ role: "tool" as const, tool_call_id: r.id, content: r.content })),
      )
      if (round.outcome) return round.outcome
    }
  }

  protected appendUserTurn(content: MessageContent): void {
    this.answerOpenToolCalls()
    this.messages.push({ role: "user", content: toOpenAiUserContent(content) })
  }

  private answerOpenToolCalls(): void {
    const answered = new Set<string>()
    let turn = this.messages.length - 1
    for (; turn >= 0; turn--) {
      const reply = this.messages[turn]
      if (reply.role !== "tool") break
      answered.add(reply.tool_call_id)
    }
    const assistant = this.messages[turn]
    if (assistant?.role !== "assistant" || !assistant.tool_calls) return
    for (const call of assistant.tool_calls) {
      if (answered.has(call.id)) continue
      this.messages.push({ role: "tool", tool_call_id: call.id, content: UNANSWERED_RESULT })
    }
  }
}
