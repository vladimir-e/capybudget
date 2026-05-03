/**
 * Anthropic API adapter — implements `CapySession` against the Anthropic
 * Messages API directly from the renderer.
 *
 * Why "synthetic stream-json": the existing UI consumes Claude CLI's
 * stream-json (decoded by `parseStreamLine` in `capy-stream.ts`). To keep
 * all UI plumbing — cumulative-text merging in `use-capy-session`,
 * `appendNormalizeBlock` in the import store, render-block extraction —
 * working without modification, this adapter synthesizes the same
 * `assistant` / `result` / `error` JSON lines as `SessionEvent`
 * `stdout` events. The cost is one shape-conversion function; the
 * benefit is zero UI changes.
 *
 * Tool dispatch happens in-process via `runTool` from
 * `@capybudget/intelligence`. The agentic loop owns the message history
 * (`messages`) and an `AbortController` so `stop()` can interrupt the
 * in-flight request without leaving dangling `tool_use` blocks (which
 * the API would reject on the next turn).
 *
 * Tauri's webview is a real browser, so the SDK works with
 * `dangerouslyAllowBrowser: true`. The flag is intended to discourage
 * bundling API keys into public web apps; here the key is the user's
 * own and already lives on disk.
 */

import Anthropic from "@anthropic-ai/sdk"
import {
  runTool,
  getToolDefinitions,
  type ApiAdapterOptions,
  type CapySession,
  type MessageContent,
  type SessionEvent,
} from "@capybudget/intelligence"

const MAX_TOKENS = 8192

/** Tools exposed to the model — chat-relevant only. Import + CSV tools
 *  arrive in Phase B together with the Read tool. */
function getAnthropicTools(): Anthropic.Tool[] {
  return getToolDefinitions().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }))
}

/** Convert the app's MessageContent (CLI-style — string or
 *  `{type:"text"|"image"}` blocks) into an Anthropic user message. */
function toAnthropicUserContent(
  content: MessageContent,
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text }
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

/** Synthesize the Claude-CLI `assistant` stream-json line for a partial
 *  turn. Text is cumulative — accumulated by the caller before this. */
function assistantLine(blocks: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: blocks },
  })
}

const RESULT_LINE = JSON.stringify({ type: "result" })

function errorLine(message: string): string {
  return JSON.stringify({ type: "error", error: { message } })
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
      // Suppress the synthetic `result` line if stop()/kill() bailed
      // the loop — the UI has already shown the interrupted state.
      if (!this.interrupted && !this.killed) {
        this.emit({ type: "stdout", line: RESULT_LINE })
      }
    } catch (err) {
      // AbortError lands here when stop()/kill() interrupts the in-flight
      // stream — that's expected, not an error to surface. Anything else
      // is a real failure.
      if (this.wasAborted(err)) return
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: "stdout", line: errorLine(message) })
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

      // Stream content blocks to the UI as they arrive. Text is accumulated
      // here so we only ever emit cumulative text (matches Claude CLI).
      let accumulatedText = ""
      const completedBlocks: Array<Record<string, unknown>> = []
      let currentTextDraftIndex: number | null = null

      stream.on("text", (delta) => {
        accumulatedText += delta
        if (currentTextDraftIndex === null) {
          currentTextDraftIndex = completedBlocks.length
          completedBlocks.push({ type: "text", text: accumulatedText })
        } else {
          completedBlocks[currentTextDraftIndex] = {
            type: "text",
            text: accumulatedText,
          }
        }
        this.emit({ type: "stdout", line: assistantLine(completedBlocks) })
      })

      stream.on("contentBlock", (block) => {
        // Reset the cumulative-text draft when any block finishes —
        // a subsequent text block starts a fresh accumulator (matches
        // Claude-CLI's wire format, where each text block stands alone
        // in the assistant content array).
        if (block.type === "tool_use") {
          accumulatedText = ""
          currentTextDraftIndex = null
          completedBlocks.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          })
          this.emit({ type: "stdout", line: assistantLine(completedBlocks) })
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
      // tool_results back as a single user turn.
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of finalMessage.content) {
        if (block.type !== "tool_use") continue
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

  private emit(event: SessionEvent): void {
    this.opts.onEvent(event)
  }
}
