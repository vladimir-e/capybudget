/**
 * OpenAI API adapter — implements `CapySession` against OpenAI's Chat
 * Completions API directly from the renderer.
 *
 * Why chat.completions (not the newer responses API): chat.completions
 * is the stable, broadly-compatible endpoint — same wire shape across
 * the GPT-4 family, GPT-4o, GPT-4.1, GPT-5. The responses API has
 * subtler streaming semantics and a different tool-call shape that
 * would force a divergent code path. For a multi-provider abstraction
 * the simpler, version-stable path is the right pick. Revisit if a
 * specific model becomes responses-only.
 *
 * Mirrors `AnthropicSession`'s shape: same lifecycle (`send`/`stop`/
 * `restart`/`kill`), same `interrupted` flag pattern that drops
 * trailing assistant turns with unmatched `tool_calls` (OpenAI's
 * analogue of unmatched `tool_use`). Emits `StreamEvent`s directly —
 * `content` blocks carry the **complete cumulative blocks array** for
 * the current user→done cycle (entire agentic loop, across iterations
 * and tool calls — never just one model turn).
 *
 * Tauri's webview is a real browser, so the SDK works with
 * `dangerouslyAllowBrowser: true`. The flag is intended to discourage
 * bundling API keys into public web apps; here the key is the user's
 * own and already lives on disk.
 *
 * Notable protocol deltas vs Anthropic (handled inline below):
 *   - Tool format: `{ type: "function", function: {...} }`.
 *   - Tool calls stream as deltas; arguments arrive as a JSON string
 *     spread across many chunks. Per-`tool_call.index` accumulator,
 *     parsed only after `finish_reason: "tool_calls"` (or stream end).
 *   - Tool results are a separate `tool` role message per call.
 *   - Images use `{ type: "image_url", image_url: { url: "data:..." } }`.
 *   - System prompt is a `system` role message at the head of each
 *     request (not a top-level field).
 *   - `delta.content` is delta text, not cumulative — accumulate locally.
 */

import OpenAI from "openai"
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
function getOpenAiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return getToolDefinitions().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
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
 *  document blocks) into an OpenAI user message. Documents (PDFs) are
 *  unsupported on chat.completions: we drop the block and replace it
 *  with a text note describing what happened so the model can respond
 *  coherently to the user (e.g. "I can't read PDFs here — could you
 *  paste the contents or share a CSV?") rather than fail with a
 *  cryptic SDK error. This makes provider divergence the adapter's
 *  responsibility; callers attach PDF blocks uniformly. */
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
        type: "text",
        text: "[The user attached a PDF document, but this model cannot read PDFs directly. Ask the user to share the contents another way — paste as text, export to CSV, or share a screenshot of the relevant page.]",
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

/** Per-`tool_call.index` accumulator built up from streamed deltas.
 *  Arguments arrive as a JSON string sliced across many chunks; we
 *  concatenate and parse once after the stream finishes. */
interface ToolCallAccumulator {
  id: string
  name: string
  argsString: string
  /** Result of parsing argsString once, lazily. `undefined` while the
   *  stream is still running. After finalize: the parsed object on
   *  success, or an Error when the JSON was malformed. */
  parsed?: Record<string, unknown> | Error
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

export class OpenAiSession implements CapySession {
  private readonly client: OpenAI
  private readonly opts: ApiAdapterOptions
  private readonly messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  private abortController: AbortController | null = null
  private alive = false
  private killed = false
  /** Flipped by stop(); checked in the agentic loop so we don't push
   *  tool messages that reference an assistant turn we just dropped. */
  private interrupted = false
  /** Per-session tool-call counter. Compared against
   *  SESSION_TOOL_CALL_BUDGET to halt runaway loops. */
  private toolCallCount = 0

  constructor(opts: ApiAdapterOptions) {
    this.opts = opts
    this.client = new OpenAI({
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
      content: toOpenAiUserContent(content),
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
   * that has unmatched `tool_calls` blocks. Keep `messages` otherwise
   * intact so the next `send()` continues the conversation.
   */
  async stop(): Promise<void> {
    this.interrupted = true
    this.abortController?.abort()
    this.abortController = null
    this.dropTrailingUnmatchedToolCalls()
  }

  /** Discard history, abort if running. Next send starts fresh. */
  async restart(): Promise<void> {
    this.abortController?.abort()
    this.abortController = null
    this.messages.length = 0
    this.alive = false
    this.toolCallCount = 0
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
    const tools = getOpenAiTools()

    // Cumulative across the entire user→done cycle. Each agentic-loop
    // iteration is one model turn; its blocks append here rather than
    // replacing per-iteration state. Emits carry the full array so the
    // consumer can replace the trailing assistant message wholesale
    // without losing earlier turns' charts/tables.
    const completedBlocks: ContentBlock[] = []
    const emitContent = () => {
      if (completedBlocks.length === 0) return
      this.opts.onEvent({ type: "content", blocks: [...completedBlocks] })
    }

    while (true) {
      if (this.killed) return
      if (this.interrupted) return

      this.abortController = new AbortController()

      // System prompt as a `system` role message at the head of each
      // request — kept out of `this.messages` so restart() resets cleanly.
      const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: this.opts.systemPrompt },
        ...this.messages,
      ]

      const stream = await this.client.chat.completions.create(
        {
          model: this.opts.model,
          messages: requestMessages,
          tools,
          stream: true,
          // max_completion_tokens (not max_tokens): the former works on all current
          // chat models, the latter is rejected by GPT-5 and the o-series.
          max_completion_tokens: MAX_TOKENS,
        },
        { signal: this.abortController.signal },
      )

      // ── Per-stream state ──────────────────────────────────────
      // Text deltas are not cumulative; accumulate locally into a
      // fresh text block for this iteration (previous turns' text is
      // already finalized in `completedBlocks`).
      let accumulatedText = ""
      let currentTextDraftIndex: number | null = null
      // Tool calls stream as deltas keyed by `index`; arguments arrive
      // sliced across many chunks. Parse only after the stream ends.
      const toolAccs = new Map<number, ToolCallAccumulator>()
      let finishReason: string | null = null

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue
        const delta = choice.delta

        if (typeof delta.content === "string" && delta.content.length > 0) {
          accumulatedText += delta.content
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
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
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
          // OpenAI keeps the stream open for terminal usage chunks even
          // after `finish_reason` arrives; we have all the assistant
          // content we need, but break only when the loop ends so the
          // SDK can drain cleanly. (Don't `break` here: the iterator
          // expects to be consumed to completion.)
        }
      }

      // ── Build the assistant turn we just received ──────────────
      const assistantToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = []
      // Sort by index so tool_calls preserve their on-the-wire order.
      const sortedIndices = [...toolAccs.keys()].sort((a, b) => a - b)
      const assistantTextOnly = accumulatedText
      for (const idx of sortedIndices) {
        const acc = toolAccs.get(idx)!
        const parsed = finalizeToolArgs(acc)
        assistantToolCalls.push({
          id: acc.id,
          type: "function",
          function: { name: acc.name, arguments: acc.argsString },
        })
        // For UI display only: malformed args degrade to {} so the tool
        // block still renders. The error surfaces in the tool result
        // message below.
        const inputForRender = parsed instanceof Error ? {} : parsed
        const cb = toolUseToContentBlock(acc.name, inputForRender)
        if (cb) completedBlocks.push(cb)
      }

      if (assistantToolCalls.length > 0) {
        // Re-emit the content event with tool blocks visible to the UI
        // (matches the per-block emit in the Anthropic adapter).
        emitContent()
      }

      const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        // Empty content is allowed when tool_calls are present.
        content: assistantTextOnly.length > 0 ? assistantTextOnly : null,
      }
      if (assistantToolCalls.length > 0) {
        assistantMessage.tool_calls = assistantToolCalls
      }
      this.messages.push(assistantMessage)

      if (finishReason !== "tool_calls") return

      // Execute every tool_call in this turn; OpenAI wants one `tool`
      // message per call appended after the assistant turn. Each call
      // counts against the per-session budget — once exhausted, the
      // remaining calls in this turn get a "budget exhausted" error
      // result and we exit cleanly after pushing them all back so the
      // API doesn't see dangling tool_calls.
      const toolMessages: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = []
      let budgetExhausted = false
      for (const idx of sortedIndices) {
        const acc = toolAccs.get(idx)!
        this.toolCallCount++
        if (this.toolCallCount > SESSION_TOOL_CALL_BUDGET) {
          budgetExhausted = true
          toolMessages.push({
            role: "tool",
            tool_call_id: acc.id,
            content: `Error: tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`,
          })
          continue
        }
        const parsed = finalizeToolArgs(acc)
        if (parsed instanceof Error) {
          toolMessages.push({
            role: "tool",
            tool_call_id: acc.id,
            content: `Error: invalid JSON arguments — ${parsed.message}`,
          })
          continue
        }
        let resultText: string
        try {
          resultText = await runTool(acc.name, parsed, {
            repo: this.opts.repo,
            fileAdapter: this.opts.fileAdapter,
            budgetPath: this.opts.budgetPath,
          })
        } catch (err) {
          resultText = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        toolMessages.push({
          role: "tool",
          tool_call_id: acc.id,
          content: resultText,
        })
      }

      // If stop() ran while tools were executing, the trailing assistant
      // turn was dropped — pushing tool messages referencing its
      // tool_call_ids would 400 on the next request. Bail out.
      if (this.interrupted || this.killed) return

      this.messages.push(...toolMessages)
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
   * If the trailing assistant turn has any `tool_calls` without matching
   * `tool` role messages following it, drop the assistant turn. Sending
   * a follow-up request with dangling tool_calls would 400.
   */
  private dropTrailingUnmatchedToolCalls(): void {
    const last = this.messages[this.messages.length - 1]
    if (!last || last.role !== "assistant") return
    if (last.tool_calls && last.tool_calls.length > 0) {
      this.messages.pop()
    }
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
