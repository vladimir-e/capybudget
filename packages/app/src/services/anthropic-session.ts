import Anthropic from "@anthropic-ai/sdk"
import {
  buildRenderToolMap,
  runTool,
  getToolDefinitions,
  SESSION_TOOL_CALL_BUDGET,
  type ApiAdapterOptions,
  type CapySession,
  type ContentBlock,
  type MessageContent,
} from "@capybudget/intelligence"

const MAX_TOKENS = 8192

function getAnthropicTools(): Anthropic.Tool[] {
  return getToolDefinitions().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }))
}

const RENDER_TOOL_MAP = buildRenderToolMap()

function toolUseToContentBlock(name: string, input: Record<string, unknown>): ContentBlock | null {
  const renderFn = RENDER_TOOL_MAP[name]
  if (renderFn) return renderFn(input)
  return { type: "tool-activity", tool: name }
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

export class AnthropicSession implements CapySession {
  private readonly client: Anthropic
  private readonly opts: ApiAdapterOptions
  private readonly messages: Anthropic.MessageParam[] = []
  private abortController: AbortController | null = null
  private alive = false
  private killed = false
  private interrupted = false
  private drainSkipped = false
  private toolCallCount = 0

  constructor(opts: ApiAdapterOptions) {
    this.opts = opts
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // Tauri webview — key lives on disk, not bundled into a public app.
      dangerouslyAllowBrowser: true,
    })
  }

  get isAlive(): boolean {
    return this.alive
  }

  async send(content: MessageContent): Promise<void> {
    if (this.killed) return

    this.interrupted = false
    this.drainSkipped = false
    this.messages.push({
      role: "user",
      content: toAnthropicUserContent(content),
    })
    this.alive = true

    try {
      await this.runAgenticLoop()
      if (!this.interrupted && !this.killed) {
        this.opts.onEvent({ type: "done" })
      }
    } catch (err) {
      if (this.wasAborted(err)) return
      const message = err instanceof Error ? err.message : String(err)
      this.opts.onEvent({ type: "error", message })
    } finally {
      this.abortController = null
      this.drainSkipped = false
    }
  }

  async stop(): Promise<void> {
    this.interrupted = true
    this.abortController?.abort()
    this.abortController = null
    this.dropTrailingUnmatchedToolUse()
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

  private async runAgenticLoop(): Promise<void> {
    const tools = getAnthropicTools()

    const completedBlocks: ContentBlock[] = []
    const emitContent = () => {
      if (completedBlocks.length === 0) return
      this.opts.onEvent({ type: "content", blocks: [...completedBlocks] })
    }

    while (true) {
      if (this.killed) return
      if (this.interrupted) return

      this.abortController = new AbortController()

      const stream = this.client.messages.stream(
        {
          model: this.opts.model,
          system: this.opts.systemPrompt,
          messages: this.messages,
          tools,
          max_tokens: MAX_TOKENS,
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
          const cb = toolUseToContentBlock(
            block.name,
            (block.input ?? {}) as Record<string, unknown>,
          )
          if (cb) {
            completedBlocks.push(cb)
            emitContent()
          }
        } else if (block.type === "text") {
          accumulatedText = ""
          currentTextDraftIndex = null
        }
      })

      // `message` fires at message_stop; `finalMessage()` would also await the
      // SSE tail (seconds of latency for a usage chunk we don't display).
      const finalMessage = await new Promise<Anthropic.Message>((resolve, reject) => {
        stream.once("message", (msg) => resolve(msg))
        stream.once("abort", (err) => reject(err))
        stream.once("error", (err) => reject(err))
      })

      this.drainSkipped = true
      stream.controller.abort()

      this.messages.push({
        role: "assistant",
        content: finalMessage.content,
      })

      if (finalMessage.stop_reason !== "tool_use") return

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      let budgetExhausted = false
      for (const block of finalMessage.content) {
        if (block.type !== "tool_use") continue
        this.toolCallCount++
        if (this.toolCallCount > SESSION_TOOL_CALL_BUDGET) {
          budgetExhausted = true
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Error: tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`,
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
            },
          )
        } catch (err) {
          ok = false
          resultText = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        this.opts.onEvent({ type: "tool-result", tool: block.name, id: block.id, ok })
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        })
      }

      // stop() dropped the trailing assistant turn — pushing tool_results that
      // reference its tool_use_ids would 400 on the next request.
      if (this.interrupted || this.killed) return

      this.messages.push({ role: "user", content: toolResults })
      if (budgetExhausted) {
        this.interrupted = true
        this.opts.onEvent({
          type: "error",
          message: `Tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`,
        })
        return
      }
    }
  }

  private dropTrailingUnmatchedToolUse(): void {
    const last = this.messages[this.messages.length - 1]
    if (!last || last.role !== "assistant") return
    const content = last.content
    if (typeof content === "string") return
    const hasToolUse = content.some((b) => b.type === "tool_use")
    if (hasToolUse) this.messages.pop()
  }

  private wasAborted(err: unknown): boolean {
    if (this.killed) return true
    if (this.drainSkipped) return true
    if (err instanceof Error) {
      if (err.name === "AbortError") return true
      if ((err as { type?: string }).type === "aborted") return true
    }
    return this.abortController?.signal.aborted === true
  }
}
