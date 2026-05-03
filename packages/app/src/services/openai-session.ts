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
 * Mirrors `AnthropicSession`'s shape: synthesizes Claude-CLI-style
 * `assistant` / `result` / `error` JSON lines as `SessionEvent`
 * `stdout` events, so `parseStreamLine` and the cumulative-text
 * merging downstream work with zero UI changes. Tool dispatch is
 * in-process via `runTool`. `stop()` aborts the in-flight stream and
 * drops any trailing assistant turn with unmatched `tool_calls` so
 * the next request doesn't 400.
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

/** Convert the app's MessageContent (CLI-style — string or
 *  `{type:"text"|"image"}` blocks) into an OpenAI user message. */
function toOpenAiUserContent(
  content: MessageContent,
): OpenAI.Chat.Completions.ChatCompletionUserMessageParam["content"] {
  if (typeof content === "string") return content
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text }
    }
    return {
      type: "image_url",
      image_url: {
        url: `data:${block.source.media_type};base64,${block.source.data}`,
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
          max_tokens: MAX_TOKENS,
        },
        { signal: this.abortController.signal },
      )

      // ── Per-stream state ──────────────────────────────────────
      // Text deltas are not cumulative; accumulate here and emit
      // cumulative `assistant` lines so downstream cumulative-text
      // merging keeps working unchanged.
      let accumulatedText = ""
      const completedBlocks: Array<Record<string, unknown>> = []
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
            completedBlocks.push({ type: "text", text: accumulatedText })
          } else {
            completedBlocks[currentTextDraftIndex] = {
              type: "text",
              text: accumulatedText,
            }
          }
          this.emit({ type: "stdout", line: assistantLine(completedBlocks) })
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
      const completedBlocksFinal = [...completedBlocks]
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
        completedBlocksFinal.push({
          type: "tool_use",
          id: acc.id,
          name: acc.name,
          // For UI display only: malformed args degrade to {} so the
          // tool_use block still renders. The error surfaces in the
          // tool result message below.
          input: parsed instanceof Error ? {} : parsed,
        })
      }

      if (assistantToolCalls.length > 0) {
        // Re-emit the assistant line with tool_use blocks visible to
        // the UI (matches the Anthropic adapter's `contentBlock` emit).
        this.emit({ type: "stdout", line: assistantLine(completedBlocksFinal) })
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
      // message per call appended after the assistant turn.
      const toolMessages: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = []
      for (const idx of sortedIndices) {
        const acc = toolAccs.get(idx)!
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

  private emit(event: SessionEvent): void {
    this.opts.onEvent(event)
  }
}
