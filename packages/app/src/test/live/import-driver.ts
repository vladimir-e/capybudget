import {
  FileStagingStore,
  ImportOrchestrator,
  buildImportSystemPrompt,
  createStructuredImportSession,
  type ImportEvent,
  type ImportPhase,
} from "@capybudget/intelligence"
import {
  AnthropicSession,
  OllamaSession,
  OpenAiSession,
} from "@capybudget/intelligence/adapters"
import type { ImportTransaction } from "@capybudget/core"
import { nodeFileAdapter } from "@capybudget/mcp"
import type { LiveBudget } from "./budget-fixture"
import { intelligenceConfig, type LiveTarget } from "./targets"

export interface ImportRun {
  events: ImportEvent[]
  rows: ImportTransaction[]
  error?: string
  warnings: string[]
}

export type ImportMode = "start" | "enrich"

export class ImportDriver {
  readonly staging: FileStagingStore

  constructor(
    private readonly target: LiveTarget,
    private readonly budget: LiveBudget,
  ) {
    this.staging = new FileStagingStore(nodeFileAdapter, budget.path)
  }

  async run(mode: ImportMode, options: { stopAtPhase?: ImportPhase } = {}): Promise<ImportRun> {
    const { budget } = this
    const session = createStructuredImportSession({
      config: intelligenceConfig(this.target),
      adapters: {
        anthropic: (o) => new AnthropicSession(o),
        openai: (o) => new OpenAiSession(o),
        ollama: (o) => new OllamaSession(o),
      },
      options: {
        budgetPath: budget.path,
        systemPrompt: buildImportSystemPrompt(),
        repo: budget.repo,
        fileAdapter: nodeFileAdapter,
        currency: budget.meta.defaultCurrency,
      },
    })
    if (!session) throw new Error(`createStructuredImportSession returned null for ${this.target.label}`)

    const events: ImportEvent[] = []
    const orchestrator: ImportOrchestrator = new ImportOrchestrator({
      session,
      staging: this.staging,
      budget: {
        getHistory: () => budget.repo.getTransactions(),
        getCategories: () => budget.repo.getCategories(),
        getAccounts: () => budget.repo.getAccounts(),
      },
      onEvent: (event) => {
        events.push(event)
        if (event.type === "phase" && event.phase === options.stopAtPhase) void orchestrator.stop()
      },
    })
    await (mode === "start" ? orchestrator.start() : orchestrator.enrich())

    const staged = await this.staging.readTransactions()
    const failure = events.find((e) => e.type === "error")
    return {
      events,
      rows: staged?.rows ?? [],
      error: failure?.type === "error" ? JSON.stringify(failure.notice) : undefined,
      warnings: events.flatMap((e) =>
        e.type === "log" && e.entry.level !== "info" ? [JSON.stringify(e.entry.notice)] : [],
      ),
    }
  }
}
