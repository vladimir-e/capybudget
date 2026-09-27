import Anthropic from "@anthropic-ai/sdk"
import { buildRenderToolMap, RENDER_FOLLOWUPS_TOOL_NAME } from "../render-map"
import { extractErrorMessage } from "../error-message"
import { runTool, getToolDefinitions, SESSION_TOOL_CALL_BUDGET } from "../tools"
import {
  BUDGET_EXHAUSTED_RESULT,
  MAX_OUTPUT_TOKENS,
  STOPPED_RESULT,
  UNANSWERED_RESULT,
  cutOffOutcome,
  outcomeEvent,
} from "./agent-turn"
import type { LoopOutcome } from "./agent-turn"
import type { ApiAdapterOptions } from "../factory"
import type { CapySession } from "../session"
import type { ContentBlock, FileAttachment, MessageContent } from "../types"
import { parseStructured, schemaBody } from "../structured"
import type { JsonSchema, StructuredCallOptions, StructuredMessage, StructuredSession } from "../structured"

const RENDER_TOOL_MAP = buildRenderToolMap()

function toolUseToContentBlock(name: string, input: Record<string, unknown>): ContentBlock {
  const rendered = RENDER_TOOL_MAP[name]?.(input) ?? null
  return rendered ?? { type: "tool-activity", tool: name }
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

export class AnthropicSession implements CapySession, StructuredSession {
  private readonly client: Anthropic
  private readonly opts: ApiAdapterOptions
  private readonly tools: Anthropic.Tool[]
  private readonly messages: Anthropic.MessageParam[] = []
  private abortController: AbortController | null = null
  private alive = false
  private killed = false
  private interrupted = false
  private toolCallCount = 0
  private idle: Promise<void> = Promise.resolve()
  /** Attachments on the current turn — staged by `start_import`, then cleared.
   *  Held outside `messages` because the flattened message content can't be
   *  turned back into files. */
  private turnAttachments: readonly FileAttachment[] = []

  constructor(opts: ApiAdapterOptions) {
    this.opts = opts
    this.tools = getToolDefinitions({ pdfSupported: opts.pdfSupported }).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }))
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // Tauri webview — key lives on disk, not bundled into a public app.
      dangerouslyAllowBrowser: true,
    })
  }

  get isAlive(): boolean {
    return this.alive
  }

  async send(content: MessageContent, attachments: readonly FileAttachment[] = []): Promise<void> {
    if (this.killed) return

    const previous = this.idle
    let release!: () => void
    this.idle = new Promise((resolve) => (release = resolve))
    await previous

    this.interrupted = false
    this.turnAttachments = attachments
    this.answerOpenToolUse()
    this.appendUserContent(toAnthropicUserContent(content))
    this.alive = true

    try {
      const outcome = await this.runAgenticLoop()
      if (!this.interrupted && !this.killed) {
        this.opts.onEvent(outcomeEvent(outcome))
      }
    } catch (err) {
      if (this.wasAborted(err)) return
      const { message, status } = extractErrorMessage(err)
      this.opts.onEvent({ type: "error", message, status, provider: "anthropic" })
    } finally {
      this.turnAttachments = []
      this.abortController = null
      release()
    }
  }

  async stop(): Promise<void> {
    this.interrupted = true
    this.abortController?.abort()
    this.abortController = null
  }

  async restart(): Promise<void> {
    this.abortController?.abort()
    this.abortController = null
    this.messages.length = 0
    this.alive = false
    this.toolCallCount = 0
  }

  async kill(): Promise<void> {
    this.killed = true
    this.abortController?.abort()
    this.abortController = null
    this.alive = false
  }

  async structured<T = unknown>(
    messages: readonly StructuredMessage[],
    schema: JsonSchema,
    options?: StructuredCallOptions,
  ): Promise<T> {
    const params: Anthropic.MessageStreamParams = {
      model: this.opts.model,
      system: this.opts.systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: toAnthropicUserContent(m.content),
      })),
      max_tokens: MAX_OUTPUT_TOKENS,
      // `output_config.format` enforces the schema unconditionally, so the
      // OpenAI-only `strict` marker is dropped from the schema Anthropic sees.
      output_config: {
        format: { type: "json_schema", schema: schemaBody(schema) },
      },
    }

    const message = await this.streamStructured(params, options?.onText)

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
    onText?: (text: string) => void,
  ): Promise<Anthropic.Message> {
    const stream = this.client.messages.stream(params)
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

  private async runAgenticLoop(): Promise<LoopOutcome> {
    const tools = this.tools

    const completedBlocks: ContentBlock[] = []
    const emitContent = () => {
      if (completedBlocks.length === 0) return
      this.opts.onEvent({ type: "content", blocks: [...completedBlocks] })
    }

    while (true) {
      if (this.killed || this.interrupted) return "done"

      this.abortController = new AbortController()
      const iterationStart = completedBlocks.length

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
          tools,
          max_tokens: MAX_OUTPUT_TOKENS,
        },
        { signal: this.abortController.signal },
      )

      let accumulatedText = ""
      let currentTextDraftIndex: number | null = null

      stream.on("text", (delta) => {
        accumulatedText += delta
        if (currentTextDraftIndex === null) {
          currentTextDraftIndex = completedBlocks.length
          completedBlocks.push({ type: "text", content: accumulatedText })
        } else {
          completedBlocks[currentTextDraftIndex] = {
            type: "text",
            content: accumulatedText,
          }
        }
        emitContent()
      })

      stream.on("contentBlock", (block) => {
        if (block.type === "tool_use") {
          accumulatedText = ""
          currentTextDraftIndex = null
          completedBlocks.push(
            toolUseToContentBlock(
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
            ),
          )
          emitContent()
        } else if (block.type === "text") {
          accumulatedText = ""
          currentTextDraftIndex = null
        }
      })

      // Resolve on `message` (message_stop) instead of `finalMessage()` — and don't
      // abort afterwards. WKWebView leaves the aborted fetch body half-open, which
      // can stall the next iteration's request for minutes.
      const finalMessage = await new Promise<Anthropic.Message>((resolve, reject) => {
        stream.once("message", (msg) => resolve(msg))
        stream.once("abort", (err) => reject(err))
        stream.once("error", (err) => reject(err))
      })

      const content = finalMessage.content
      const stopReason = finalMessage.stop_reason
      if (stopReason === "end_turn" || stopReason === "stop_sequence") {
        if (content.length > 0) this.messages.push({ role: "assistant", content })
        return "done"
      }
      if (stopReason !== "tool_use") {
        const firstToolUse = content.findIndex((b) => b.type === "tool_use")
        const droppedCalls = firstToolUse !== -1
        const beforeTools = droppedCalls ? content.slice(0, firstToolUse) : content
        let kept = 0
        beforeTools.forEach((b, i) => {
          if (b.type === "text" && b.text.length > 0) kept = i + 1
        })
        if (kept > 0) this.messages.push({ role: "assistant", content: content.slice(0, kept) })
        if (droppedCalls) {
          const shown = completedBlocks.splice(iterationStart)
          completedBlocks.push(...shown.filter((b) => b.type === "text"))
          this.opts.onEvent({ type: "content", blocks: [...completedBlocks] })
        }
        return cutOffOutcome(kept > 0, droppedCalls)
      }

      this.messages.push({ role: "assistant", content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      let budgetExhausted = false
      let terminalToolSeen = false
      for (const block of content) {
        if (block.type !== "tool_use") continue
        if (this.interrupted || this.killed) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: STOPPED_RESULT,
            is_error: true,
          })
          continue
        }
        this.toolCallCount++
        if (this.toolCallCount > SESSION_TOOL_CALL_BUDGET) {
          budgetExhausted = true
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: BUDGET_EXHAUSTED_RESULT,
          })
          continue
        }
        let resultText: string
        let ok = true
        try {
          resultText = await runTool(
            block.name,
            (block.input ?? {}) as Record<string, unknown>,
            {
              repo: this.opts.repo,
              fileAdapter: this.opts.fileAdapter,
              budgetPath: this.opts.budgetPath,
              currency: this.opts.currency,
              // Live read so a manual rate edit lands on this call's stamping,
              // without rebuilding the session.
              currencies: this.opts.getCurrencies?.() ?? this.opts.currencies,
              attachments: [...this.turnAttachments],
              importSupported: this.opts.importSupported,
              pdfSupported: this.opts.pdfSupported,
            },
          )
        } catch (err) {
          ok = false
          resultText = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        // A failed followups call is not terminal — the loop must continue so
        // the model sees the error result and recovers.
        if (ok && block.name === RENDER_FOLLOWUPS_TOOL_NAME) terminalToolSeen = true
        this.opts.onEvent({ type: "tool-result", tool: block.name, id: block.id, ok })
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        })
      }

      this.messages.push({ role: "user", content: toolResults })
      if (budgetExhausted) return "budgetExhausted"
      // Terminal-signal tool — exit; the next user message merges into this turn.
      if (terminalToolSeen) return "done"
    }
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
    const last = this.messages[this.messages.length - 1]
    const incomingBlocks = normalizeUserContent(content)
    if (last && last.role === "user") {
      const existing = normalizeUserContent(last.content)
      last.content = [...existing, ...incomingBlocks]
      return
    }
    this.messages.push({ role: "user", content: incomingBlocks })
  }

  private wasAborted(err: unknown): boolean {
    if (this.killed) return true
    if (err instanceof Error) {
      if (err.name === "AbortError") return true
      if ((err as { type?: string }).type === "aborted") return true
    }
    return this.abortController?.signal.aborted === true
  }
}
