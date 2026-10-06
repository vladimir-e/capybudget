import type { StreamEvent } from "@capybudget/intelligence"
import type { Transaction } from "@capybudget/core"
import { openLiveBudget, type LiveBudget } from "./budget-fixture"
import { ChatDriver, type Turn } from "./chat-driver"
import { ImportDriver } from "./import-driver"
import type { LiveTarget } from "./targets"

const DISK_FLUSH_WAIT_MS = 5_000

export class LiveContext {
  private openedBudget: LiveBudget | null = null
  private driver: ChatDriver | null = null
  private importDriver: ImportDriver | null = null

  constructor(private readonly target: LiveTarget) {}

  async budget(): Promise<LiveBudget> {
    this.openedBudget ??= await openLiveBudget()
    return this.openedBudget
  }

  async chat(text: string, stopWhen?: (event: StreamEvent) => boolean): Promise<Turn> {
    this.driver ??= new ChatDriver(this.target, await this.budget())
    return this.driver.send(text, { stopWhen })
  }

  async importer(): Promise<ImportDriver> {
    this.importDriver ??= new ImportDriver(this.target, await this.budget())
    return this.importDriver
  }

  async rowsOnDisk(marker: string, expected: number): Promise<Transaction[]> {
    const budget = await this.budget()
    const deadline = Date.now() + DISK_FLUSH_WAIT_MS
    let rows: Transaction[] = []
    do {
      rows = (await budget.transactionsOnDisk()).filter(
        (t) => t.merchant.includes(marker) || t.note.includes(marker),
      )
      if (rows.length >= expected) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    } while (Date.now() < deadline)
    return rows
  }

  async resetChat(): Promise<void> {
    await this.driver?.dispose()
    this.driver = null
  }

  async dispose(): Promise<void> {
    await this.resetChat()
    await this.openedBudget?.dispose()
  }
}
