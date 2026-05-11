/**
 * Anthropic API adapter — implements `CapySession` against the Anthropic
 * Messages API directly from the renderer.
 *
 * Tool dispatch happens in-process via `runTool` from
 * `@capybudget/intelligence`. The agentic loop owns the message history
 * (`messages`) and an `AbortController` so `stop()` can interrupt the
 * in-flight request without leaving dangling `tool_use` blocks (which
 * the API would reject on the next turn).
 *
 * Stream-event shape: this adapter emits `StreamEvent`s directly —
 * `content` blocks carry the **complete cumulative blocks array** for
 * the current assistant turn (never deltas), `done` on turn completion,
 * `error` on failure. Text deltas are accumulated locally so every emit
 * carries a full snapshot the consumer can replace wholesale.
 *
 * Tauri's webview is a real browser, so the SDK works with
 * `dangerouslyAllowBrowser: true`. The flag is intended to discourage
 * bundling API keys into public web apps; here the key is the user's
 * own and already lives on disk.
 */

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

/** Tool surface mirrors what the model sees in the Claude CLI:
 *  data + mutation + import + csv + read_file + render. */
function getAnthropicTools(): Anthropic.Tool[] {
  return getToolDefinitions().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }))
}

/** Render-tool name → ContentBlock builder. Shared with every adapter
 *  via `buildRenderToolMap()` so the contract lives in one place. */
const RENDER_TOOL_MAP = buildRenderToolMap()

function toolUseToContentBlock(name: string, input: Record<string, unknown>): ContentBlock | null {
  const renderFn = RENDER_TOOL_MAP[name]
  if (renderFn) return renderFn(input)
  return { type: "tool-activity", tool: name }
}

/** Convert the app's MessageContent (CLI-style — string or text/image/
 *  document blocks) into an Anthropic user message. PDFs ride through
 *  the SDK's native `document` content type. */
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
  /** Flipped by stop(); checked in the agentic loop so we don't push
   *  tool_results that reference an assistant turn we just dropped. */
  private interrupted = false
  /** Per-session tool-call counter. Compared against
   *  SESSION_TOOL_CALL_BUDGET to halt runaway loops. */
  private toolCallCount = 0

  constructor(opts: ApiAdapterOptions) {
    this.opts = opts
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      dangerouslyAllowBrowser: true,
    })
  }

  get isAlive(): boolean {
    return this.alive
  }

  async send(content: MessageContent): Promise<void> {
    if (this.killed) return

    this.interrupted = false
    this.messages.push({
      role: "user",
      content: toAnthropicUserContent(content),
    })
    this.alive = true

    try {
      await this.runAgenticLoop()
      // Suppress `done` if stop()/kill() bailed the loop — the UI has
      // already shown the interrupted state.
      if (!this.interrupted && !this.killed) {
        this.opts.onEvent({ type: "done" })
      }
    } catch (err) {
      // AbortError lands here when stop()/kill() interrupts the in-flight
      // stream — that's expected, not an error to surface. Anything else
      // is a real failure.
      if (this.wasAborted(err)) return
      const message = err instanceof Error ? err.message : String(err)
      this.opts.onEvent({ type: "error", message })
    } finally {
      this.abortController = null
    }
  }

  /**
   * Abort the in-flight request and drop any in-progress assistant turn
   * that has unmatched `tool_use` blocks. Keep `messages` otherwise
   * intact so the next `send()` continues the conversation.
   */
  async stop(): Promise<void> {
    this.interrupted = true
    this.abortController?.abort()
    this.abortController = null
    this.dropTrailingUnmatchedToolUse()
  }

  /** Discard history, abort if running. Next send starts fresh. */
  async restart(): Promise<void> {
    this.abortController?.abort()
    this.abortController = null
    this.messages.length = 0
    this.alive = false
  }

  /** Hard stop: abort, mark dead. */
  async kill(): Promise<void> {
    this.killed = true
    this.abortController?.abort()
    this.abortController = null
    this.alive = false
  }

  // ── Internal ────────────────────────────────────────────────────

  private async runAgenticLoop(): Promise<void> {
    const tools = getAnthropicTools()

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

      // Stream content blocks to the UI as they arrive. Text is
      // accumulated locally so each emit carries the full cumulative
      // blocks array — consumers replace the trailing assistant
      // message's blocks wholesale on every tick.
      let accumulatedText = ""
      const completedBlocks: ContentBlock[] = []
      let currentTextDraftIndex: number | null = null

      const emitContent = () => {
        if (completedBlocks.length === 0) return
        this.opts.onEvent({ type: "content", blocks: [...completedBlocks] })
      }

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
          // A tool_use ends the current text run. Reset the accumulator
          // so any subsequent text starts fresh as its own block —
          // matches the assistant-turn shape downstream consumers expect
          // (each text block stands alone, tool blocks are interleaved).
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

      const finalMessage = await stream.finalMessage()

      this.messages.push({
        role: "assistant",
        content: finalMessage.content,
      })

      if (finalMessage.stop_reason !== "tool_use") return

      // Execute every tool_use block in this turn; the API wants all
      // tool_results back as a single user turn. Each call counts
      // against the per-session budget — once exhausted, the remaining
      // calls in this turn get a "budget exhausted" error result and
      // we exit cleanly after pushing them all back so the API doesn't
      // see dangling tool_use blocks.
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
          resultText = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        })
      }

      // If stop() ran while tools were executing, the trailing
      // assistant turn was dropped — pushing tool_results referencing
      // its tool_use_ids would 400 on the next request. Bail out.
      if (this.interrupted || this.killed) return

      this.messages.push({ role: "user", content: toolResults })
      if (budgetExhausted) {
        // Suppress the post-loop `done` event — we surfaced an error
        // instead. Re-use the interrupted flag for that signal.
        this.interrupted = true
        this.opts.onEvent({
          type: "error",
          message: `Tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`,
        })
        return
      }
      // Loop continues with the tool results in context.
    }
  }

  /**
   * If the trailing assistant turn has any `tool_use` blocks without
   * matching `tool_result`s in a following user turn, drop it. Sending
   * a follow-up request with a dangling `tool_use` would 400.
   */
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
    if (err instanceof Error) {
      if (err.name === "AbortError") return true
      if ((err as { type?: string }).type === "aborted") return true
    }
    return this.abortController?.signal.aborted === true
  }
}
