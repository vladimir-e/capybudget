import Anthropic from "@anthropic-ai/sdk"
import { AgentSession } from "./agent-session"
import { anthropicClient } from "./clients"
import type { ToolReply } from "./agent-session"
import { UNANSWERED_RESULT, toolCallBlock } from "./agent-turn"
import type { LoopOutcome, TurnDisplay } from "./agent-turn"
import type { MessageContent, SessionProvider } from "../types"
import { STRUCTURED_MAX_RETRIES, UnreachableError, assertStructuredFinished, parseStructured, requestSignal, schemaBody } from "../structured"
import type { Ending, JsonSchema, StructuredCallOptions, StructuredMessage, StructuredSession } from "../structured"

function endingOf(reason: Anthropic.StopReason | null): Ending {
  if (reason === "end_turn" || reason === "stop_sequence" || reason === "tool_use") return "finished"
  return reason === "refusal" ? "refused" : "cutOff"
}

interface StreamedTurn {
  message: Anthropic.Message
  failure?: unknown
}

type UserContentBlock = Exclude<Anthropic.MessageParam["content"], string>[number]

function normalizeUserContent(
  content: Anthropic.MessageParam["content"],
): UserContentBlock[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : []
  }
  return content
}

function toAnthropicUserContent(
  content: MessageContent,
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text }
    }
    if (block.type === "document") {
      return {
        type: "document",
        source: {
          type: "base64",
          media_type: block.source.media_type as Anthropic.Base64PDFSource["media_type"],
          data: block.source.data,
        },
        ...(block.filename ? { title: block.filename } : {}),
      }
    }
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: block.source.media_type as Anthropic.Base64ImageSource["media_type"],
        data: block.source.data,
      },
    }
  })
}

export class AnthropicSession extends AgentSession<Anthropic.MessageParam> implements StructuredSession {
  private readonly client = anthropicClient(this.opts.apiKey)
  private readonly tools: Anthropic.Tool[] = this.toolDefinitions.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }))

  protected get providerId(): SessionProvider {
    return "anthropic"
  }

  async structured<T = unknown>(
    messages: readonly StructuredMessage[],
    schema: JsonSchema,
    options?: StructuredCallOptions,
  ): Promise<T> {
    const params: Omit<Anthropic.MessageStreamParams, "max_tokens"> = {
      model: this.opts.model,
      system: this.opts.systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: toAnthropicUserContent(m.content),
      })),
      // `output_config.format` enforces the schema unconditionally, so the
      // OpenAI-only `strict` marker is dropped from the schema Anthropic sees.
      output_config: {
        format: { type: "json_schema", schema: schemaBody(schema) },
      },
    }

    const request = requestSignal(options?.signal)
    let message: Anthropic.Message
    try {
      message = await this.withOutputCap((maxTokens) =>
        this.streamStructured({ ...params, max_tokens: maxTokens }, request.signal, options?.onText),
      )
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) throw new UnreachableError("Can't reach Anthropic. Check your internet connection.")
      throw err
    } finally {
      request.release()
    }
    assertStructuredFinished(endingOf(message.stop_reason))

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")

    return parseStructured<T>(text, schema)
  }

  /** Always streamed: the SDK refuses a non-streaming request with this large a
   *  `max_tokens`. Resolves on `message` (message_stop) like the agentic loop —
   *  see the note there on `finalMessage()`/abort under WKWebView. */
  private streamStructured(
    params: Anthropic.MessageStreamParams,
    signal: AbortSignal | undefined,
    onText?: (text: string) => void,
  ): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream(params, { signal, maxRetries: STRUCTURED_MAX_RETRIES })
    if (onText) {
      let accumulated = ""
      stream.on("text", (delta) => {
        accumulated += delta
        onText(accumulated)
      })
    }
    return new Promise<Anthropic.Message>((resolve, reject) => {
      stream.once("message", resolve)
      stream.once("abort", reject)
      stream.once("error", reject)
    })
  }

  protected async runAgenticLoop(display: TurnDisplay): Promise<LoopOutcome> {
    while (true) {
      if (this.stopped) return "stopped"

      display.beginIteration()
      const signal = this.openRequest()
      const { message, failure } = await this.withOutputCap((maxTokens) => this.streamTurn(maxTokens, signal, display))
      this.closeRequest()

      const { content, stop_reason } = message
      if (failure !== undefined) {
        this.keepPartialTurn(content, display)
        if (this.stopped) return "stopped"
        throw failure
      }
      const ending = endingOf(stop_reason)
      if (ending !== "finished") {
        this.keepPartialTurn(content, display)
        return this.stopped ? "stopped" : ending
      }

      if (content.length > 0) this.storeReply({ role: "assistant", content })
      if (stop_reason !== "tool_use") return "done"
      const round = await this.runToolCalls(
        content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> })),
        display,
      )
      this.messages.push({ role: "user", content: round.replies.map(toToolResult) })
      if (round.outcome) return round.outcome
    }
  }

  private streamTurn(maxTokens: number, signal: AbortSignal, display: TurnDisplay): Promise<StreamedTurn> {
    const stream = this.client.messages.stream(
      {
        model: this.opts.model,
        // One breakpoint at the end of system caches the whole static prefix
        // before it — tools, then system — so multi-turn loops re-read it
        // instead of re-billing ~7-8K tokens of schema every turn.
        system: [
          {
            type: "text",
            text: this.opts.systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: this.messages,
        tools: this.tools,
        max_tokens: maxTokens,
      },
      { signal },
    )

    stream.on("text", (delta) => display.appendText(delta))
    stream.on("contentBlock", (block) => {
      if (block.type === "tool_use") {
        display.addCall(block.id, toolCallBlock(block.name, (block.input ?? {}) as Record<string, unknown>))
      } else if (block.type === "text") {
        display.endText()
      }
    })

    // Resolve on `message` (message_stop) instead of `finalMessage()` — and don't
    // abort afterwards. WKWebView leaves the aborted fetch body half-open, which
    // can stall the next request for minutes.
    return new Promise<StreamedTurn>((resolve, reject) => {
      const interrupted = (failure: unknown) =>
        stream.currentMessage ? resolve({ message: stream.currentMessage, failure }) : reject(failure)
      stream.once("message", (message) => resolve({ message }))
      stream.once("abort", interrupted)
      stream.once("error", interrupted)
    })
  }

  private keepPartialTurn(content: Anthropic.ContentBlock[], display: TurnDisplay): void {
    let kept: Anthropic.ContentBlock[] = []
    for (const [i, b] of content.entries()) {
      if (b.type === "tool_use") break
      if (b.type === "text" && b.text.length > 0) kept = content.slice(0, i + 1)
    }
    display.replaceIteration(kept.flatMap((b) => (b.type === "text" && b.text.length > 0 ? [b.text] : [])))
    const tail = kept.pop()
    if (tail?.type !== "text") return
    this.storeReply({ role: "assistant", content: [...kept, { ...tail, text: this.markedIfStopped(tail.text) }] })
  }

  protected appendUserTurn(content: MessageContent): void {
    this.answerOpenToolUse()
    this.appendUserContent(toAnthropicUserContent(content))
  }

  private answerOpenToolUse(): void {
    const last = this.messages[this.messages.length - 1]
    if (!last || last.role !== "assistant" || typeof last.content === "string") return
    const results: Anthropic.ToolResultBlockParam[] = last.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        type: "tool_result",
        tool_use_id: b.id,
        content: UNANSWERED_RESULT,
        is_error: true,
      }))
    if (results.length > 0) this.messages.push({ role: "user", content: results })
  }

  // Merge into a trailing user turn — Anthropic rejects two consecutive user roles.
  private appendUserContent(content: Anthropic.MessageParam["content"]): void {
    const end = this.messages.length - 1
    const last = this.messages[end]
    const incomingBlocks = normalizeUserContent(content)
    if (last && last.role === "user") {
      this.messages[end] = { role: "user", content: [...normalizeUserContent(last.content), ...incomingBlocks] }
      return
    }
    this.messages.push({ role: "user", content: incomingBlocks })
  }
}

function toToolResult(reply: ToolReply): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: reply.id,
    content: reply.content,
    ...(reply.isError ? { is_error: true } : {}),
  }
}
