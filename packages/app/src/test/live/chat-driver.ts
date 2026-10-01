import {
  buildBudgetSnapshot,
  buildContext,
  buildSystemPrompt,
  canReadPdf,
  type CapySession,
  type ChatMessage,
  type StreamEvent,
} from "@capybudget/intelligence"
import { i18n } from "@capybudget/i18n"
import { createSession } from "@/services/create-session"
import { mergeStreamContent } from "@/hooks/merge-stream-content"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { nodeFileAdapter } from "@capybudget/mcp"
import type { LiveBudget } from "./budget-fixture"
import { intelligenceConfig, type LiveTarget } from "./targets"

const MCP_SERVER_PATH = "packages/mcp/src/server.ts"
const AI_LANGUAGE = "English"
const TURN_TIMEOUT_MS = 150_000
const STOP_SETTLE_MS = 1_500

export interface Turn {
  events: StreamEvent[]
  outcome: "done" | "error" | "stopped"
  error?: string
  text: string
  toolsRequested: string[]
  toolResults: { tool: string; ok: boolean }[]
}

export interface SendOptions {
  stopWhen?: (event: StreamEvent, soFar: readonly StreamEvent[]) => boolean
}

export class ChatDriver {
  private readonly session: CapySession
  private readonly messages: ChatMessage[] = []
  private listener: ((event: StreamEvent) => void) | null = null
  private snapshotSent = false

  constructor(
    private readonly target: LiveTarget,
    private readonly budget: LiveBudget,
  ) {
    useIntelligenceStore.setState({ config: intelligenceConfig(target) })
    const { meta } = budget
    const session = createSession({
      budgetPath: budget.path,
      mcpServerPath: MCP_SERVER_PATH,
      systemPrompt: buildSystemPrompt(meta.defaultCurrency, AI_LANGUAGE, canReadPdf(target.provider)),
      currency: meta.defaultCurrency,
      currencies: meta.currencies,
      getCurrencies: () => meta.currencies,
      onEvent: (event) => this.listener?.(event),
      onExit: () => this.listener?.({ type: "error", message: "session process exited unexpectedly" }),
      repo: budget.repo,
      fileAdapter: nodeFileAdapter,
    })
    if (!session) throw new Error(`createSession returned null for ${target.label}`)
    this.session = session
  }

  async send(text: string, options: SendOptions = {}): Promise<Turn> {
    const content = `${await this.contextHeader()}\n${text}`
    this.messages.push(
      { id: crypto.randomUUID(), role: "user", blocks: [{ type: "text", content: text }] },
      { id: crypto.randomUUID(), role: "assistant", blocks: [] },
    )

    const events: StreamEvent[] = []
    let stopped = false
    const settled = new Promise<Turn["outcome"]>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.target.label}: no done/error within ${TURN_TIMEOUT_MS / 1000}s`)),
        TURN_TIMEOUT_MS,
      )
      const finish = (outcome: Turn["outcome"]) => {
        clearTimeout(timer)
        resolve(outcome)
      }
      this.listener = (event) => {
        events.push(event)
        if (event.type === "content") this.setMessages(mergeStreamContent(this.messages, event.blocks))
        if (stopped) return
        if (event.type === "error") return finish("error")
        if (event.type === "done") return finish("done")
        if (options.stopWhen?.(event, events)) {
          stopped = true
          void this.pressStop().then(() => finish("stopped"))
        }
      }
      this.session.send(content, []).catch((err: unknown) => {
        this.listener?.({ type: "error", message: err instanceof Error ? err.message : String(err) })
      })
    })

    const outcome = await settled
    if (outcome === "stopped") await delay(STOP_SETTLE_MS)
    this.listener = null
    return summarize(events, outcome)
  }

  async dispose(): Promise<void> {
    this.listener = null
    await this.session.kill()
  }

  private async pressStop(): Promise<void> {
    await this.session.stop()
    this.session.markInterrupted?.(this.messages)
    const interrupt = { type: "text" as const, content: i18n.t("capy:session.interrupted") }
    const last = this.messages[this.messages.length - 1]
    if (last?.role === "assistant" && last.blocks.length === 0) last.blocks = [interrupt]
    else this.messages.push({ id: crypto.randomUUID(), role: "assistant", blocks: [interrupt] })
  }

  private async contextHeader(): Promise<string> {
    const { repo, meta, path } = this.budget
    const snapshot = this.snapshotSent
      ? undefined
      : buildBudgetSnapshot(
          await repo.getAccounts(),
          await repo.getTransactions(),
          await repo.getCategories(),
          meta.defaultCurrency,
        )
    this.snapshotSent = true
    return buildContext({ budgetName: meta.name, budgetPath: path, snapshot })
  }

  private setMessages(next: ChatMessage[]): void {
    this.messages.splice(0, this.messages.length, ...next)
  }
}

function summarize(events: StreamEvent[], outcome: Turn["outcome"]): Turn {
  const contents = events.flatMap((e) => (e.type === "content" ? [e.blocks] : []))
  const blocks = contents[contents.length - 1] ?? []
  const firstError = events.find((e) => e.type === "error")
  return {
    events,
    outcome,
    error: firstError?.type === "error" ? firstError.message : undefined,
    text: blocks.flatMap((b) => (b.type === "text" ? [b.content] : [])).join(""),
    toolsRequested: [
      ...new Set(contents.flat().flatMap((b) => (b.type === "tool-activity" ? [b.tool] : []))),
    ],
    toolResults: events.flatMap((e) => (e.type === "tool-result" ? [{ tool: e.tool, ok: e.ok }] : [])),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
