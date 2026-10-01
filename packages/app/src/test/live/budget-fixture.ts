import { cp, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { BudgetMeta, Transaction } from "@capybudget/core"
import { createCsvRepository, type DisposableRepository } from "@capybudget/persistence"
import { nodeFileAdapter } from "@capybudget/mcp"

export const FIXTURES_DIR = fileURLToPath(new URL("./fixtures", import.meta.url))

export interface LiveBudget {
  path: string
  meta: BudgetMeta
  repo: DisposableRepository
  transactionsOnDisk(): Promise<Transaction[]>
  dispose(): Promise<void>
}

export async function openLiveBudget(): Promise<LiveBudget> {
  const path = await mkdtemp(join(tmpdir(), "capy-live-"))
  await cp(join(FIXTURES_DIR, "budget"), path, { recursive: true })
  const meta = JSON.parse(await readFile(join(path, "budget.json"), "utf-8")) as BudgetMeta
  const repo = createCsvRepository(path, nodeFileAdapter)
  return {
    path,
    meta,
    repo,
    transactionsOnDisk: () => createCsvRepository(path, nodeFileAdapter).getTransactions(),
    async dispose() {
      await repo.dispose().catch(() => {})
      await rm(path, { recursive: true, force: true })
    },
  }
}
