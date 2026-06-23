import OpenAI from "openai"
import { buildRenderToolMap, RENDER_FOLLOWUPS_TOOL_NAME } from "../render-map"
import { extractErrorMessage } from "../error-message"
import { runTool, getToolDefinitions, SESSION_TOOL_CALL_BUDGET } from "../tools"
import type { ApiAdapterOptions } from "../factory"
import type { CapySession } from "../session"
import type { ContentBlock, FileAttachment, MessageContent } from "../types"
import { parseStructured, schemaBody } from "../structured"
import type { JsonSchema, StructuredCallOptions, StructuredMessage, StructuredSession } from "../structured"

const MAX_TOKENS = 8192

const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = getToolDefinitions().map(
  (t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }),
)

const RENDER_TOOL_MAP = buildRenderToolMap()

function toolUseToContentBlock(name: string, input: Record<string, unknown>): ContentBlock {
  const rendered = RENDER_TOOL_MAP[name]?.(input) ?? null
  return rendered ?? { type: "tool-activity", tool: name }
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
      // chat.completions can't read PDFs — degrade to a text note so the model
      // can ask the user for an alternate format instead of failing cryptically.
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

interface ToolCallAccumulator {
  id: string
  name: string
  argsString: string
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

export class OpenAiSession implements CapySession, StructuredSession {
  private readonly client: OpenAI
  private readonly opts: ApiAdapterOptions
  private readonly messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
  private abortController: AbortController | null = null
  private alive = false
  private killed = false
  private interrupted = false
  private toolCallCount = 0
  /** Attachments on the current turn — staged by `start_import`, then cleared.
   *  Held outside `messages` because the flattened message content can't be
   *  turned back into files. */
  private turnAttachments: readonly FileAttachment[] = []

  constructor(opts: ApiAdapterOptions) {
    this.opts = opts
    this.client = new OpenAI({
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

    this.interrupted = false
    this.turnAttachments = attachments
    this.messages.push({
      role: "user",
      content: toOpenAiUserContent(content),
    })
    this.alive = true

    try {
      await this.runAgenticLoop()
      if (!this.interrupted && !this.killed) {
        this.opts.onEvent({ type: "done" })
      }
    } catch (err) {
      if (this.wasAborted(err)) return
      const { message, status } = extractErrorMessage(err)
      this.opts.onEvent({ type: "error", message, status, provider: "openai" })
    } finally {
      this.turnAttachments = []
      this.abortController = null
    }
  }

  async stop(): Promise<void> {
    this.interrupted = true
    this.abortController?.abort()
    this.abortController = null
    this.dropTrailingUnmatchedToolCalls()
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
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: this.opts.systemPrompt },
      ...messages.map((m) =>
        m.role === "assistant"
          ? { role: "assistant" as const, content: m.content }
          : { role: "user" as const, content: toOpenAiUserContent(m.content) },
      ),
    ]

    // `strict` is our own marker on the schema, not a JSON-schema keyword;
    // it rides on the json_schema wrapper, not inside the schema OpenAI sees.
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.opts.model,
      messages: requestMessages,
      max_completion_tokens: MAX_TOKENS,
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
      const completion = await this.client.chat.completions.create(params)
      return parseStructured<T>(completion.choices[0]?.message.content ?? "", schema)
    }

    const stream = await this.client.chat.completions.create({ ...params, stream: true })
    let text = ""
    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      if (!choice) continue
      if (typeof choice.delta?.content === "string" && choice.delta.content.length > 0) {
        text += choice.delta.content
        options.onText(text)
      }
      // Same early break as the agentic loop — the terminal usage chunk
      // isn't needed and `return()` lets the SDK clean up.
      if (choice.finish_reason) break
    }
    return parseStructured<T>(text, schema)
  }

  private async runAgenticLoop(): Promise<void> {
    const tools = OPENAI_TOOLS

    const completedBlocks: ContentBlock[] = []
    const emitContent = () => {
      if (completedBlocks.length === 0) return
      this.opts.onEvent({ type: "content", blocks: [...completedBlocks] })
    }

    while (true) {
      if (this.killed) return
      if (this.interrupted) return

      this.abortController = new AbortController()

      // System prompt kept out of `this.messages` so restart() resets cleanly.
      // The tools + system prefix must stay byte-identical across turns for
      // OpenAI's automatic prefix caching to hit — `systemPrompt` is immutable
      // for the session's life and all per-turn context (budget snapshot, date,
      // attachments) rides in the user messages of `this.messages`, never here.
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
          // GPT-5 and the o-series reject `max_tokens`; `max_completion_tokens`
          // works across all current chat models.
          max_completion_tokens: MAX_TOKENS,
        },
        { signal: this.abortController.signal },
      )

      let accumulatedText = ""
      let currentTextDraftIndex: number | null = null
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
          // OpenAI keeps the stream open for a terminal usage chunk Capy
          // doesn't display. Breaking out of `for await` lets V8 invoke the
          // iterator's `return()`, which the SDK hooks for cleanup — no
          // explicit abort needed, and symmetric with the Anthropic adapter.
          break
        }
      }

      const assistantToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = []
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
        // Malformed args degrade to {} so the tool block still renders;
        // the JSON error surfaces in the tool result below.
        const inputForRender = parsed instanceof Error ? {} : parsed
        completedBlocks.push(toolUseToContentBlock(acc.name, inputForRender))
      }

      if (assistantToolCalls.length > 0) {
        emitContent()
      }

      // Only persist a turn that carries text or tool calls. An empty terminal
      // completion stored as `{content: null}` with no tool_calls is invalid to
      // OpenAI, and history replays on every send — so one poisons the whole
      // session. Tool-call turns keep null content (canonical).
      const hasToolCalls = assistantToolCalls.length > 0
      if (assistantTextOnly.length > 0 || hasToolCalls) {
        const assistantMessage: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: assistantTextOnly.length > 0 ? assistantTextOnly : null,
        }
        if (hasToolCalls) {
          assistantMessage.tool_calls = assistantToolCalls
        }
        this.messages.push(assistantMessage)
      }

      // Exit on a non-tool_calls finish — and on a tool_calls finish with no
      // tool calls: nothing to execute, history unchanged, so re-sending spins
      // forever and burns tokens (the tool-call budget counts executions, not
      // this). Treat the contradiction as terminal.
      if (finishReason !== "tool_calls" || !hasToolCalls) return

      const toolMessages: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = []
      let budgetExhausted = false
      let terminalToolSeen = false
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
          this.opts.onEvent({ type: "tool-result", tool: acc.name, id: acc.id, ok: false })
          toolMessages.push({
            role: "tool",
            tool_call_id: acc.id,
            content: `Error: invalid JSON arguments — ${parsed.message}`,
          })
          continue
        }
        let resultText: string
        let ok = true
        try {
          resultText = await runTool(acc.name, parsed, {
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
          })
        } catch (err) {
          ok = false
          resultText = `Error: ${err instanceof Error ? err.message : String(err)}`
        }
        // A failed followups call is not terminal — the loop must continue so
        // the model sees the error result and recovers.
        if (ok && acc.name === RENDER_FOLLOWUPS_TOOL_NAME) terminalToolSeen = true
        this.opts.onEvent({ type: "tool-result", tool: acc.name, id: acc.id, ok })
        toolMessages.push({
          role: "tool",
          tool_call_id: acc.id,
          content: resultText,
        })
      }

      // stop() dropped the trailing assistant turn — pushing tool messages
      // referencing its tool_call_ids would 400 on the next request.
      if (this.interrupted || this.killed) return

      this.messages.push(...toolMessages)
      if (budgetExhausted) {
        this.interrupted = true
        this.opts.onEvent({
          type: "error",
          message: `Tool-call budget exhausted (${SESSION_TOOL_CALL_BUDGET} calls). Stopping. Run again if more work is needed.`,
        })
        return
      }
      // Terminal-signal tool — exit. OpenAI tool messages use `role: "tool"`,
      // so the next user send lands naturally without merge gymnastics.
      if (terminalToolSeen) return
    }
  }

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
