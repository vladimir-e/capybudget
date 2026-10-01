import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, describe, expect, test } from "vitest"
import { canImport, canReadPdf, needsEnrich } from "@capybudget/intelligence"
import { FIXTURES_DIR } from "./budget-fixture"
import type { Turn } from "./chat-driver"
import type { ImportRun } from "./import-driver"
import { LiveContext } from "./live-context"
import { liveTargets, unavailableReason } from "./targets"

const MARKER = "LIVETEST"

for (const target of liveTargets()) {
  describe(target.label, () => {
    const unavailable = unavailableReason(target)
    const live = new LiveContext(target)
    afterAll(() => live.dispose())

    const scenario = (name: string, body: (live: LiveContext) => Promise<void>, skip: string | null = null) =>
      test(name, async (ctx) => {
        const reason = unavailable ?? skip
        if (reason) return ctx.skip(reason)
        try {
          await body(live)
        } catch (err) {
          await live.resetChat()
          throw err
        }
      })

    scenario("chat: plain reply", async (live) => {
      const turn = await live.chat("Reply with exactly one word: pong.")
      expectDone(turn)
      expect(turn.text.trim(), "reply text").not.toBe("")
    })

    scenario("chat: read tool", async (live) => {
      const turn = await live.chat("What's the current balance of my Checking account? Look it up with your tools.")
      expectDone(turn)
      expect(
        turn.toolResults.filter((r) => r.ok),
        `successful tool results (reply: ${JSON.stringify(turn.text.slice(0, 160))})`,
      ).not.toHaveLength(0)
    })

    scenario("chat: mutation", async (live) => {
      const turn = await live.chat(
        `Add two separate $5.00 expense transactions to my Cash account, dated today, each with merchant "${MARKER}". ` +
          "Leave the category empty. Don't ask me to confirm — just add them.",
      )
      expectDone(turn)
      expect(
        turn.toolResults.filter((r) => r.ok && r.tool.endsWith("create_transaction")),
        `create_transaction results (reply: ${JSON.stringify(turn.text.slice(0, 160))})`,
      ).not.toHaveLength(0)
      const rows = await live.rowsOnDisk(MARKER, 2)
      expect(rows, `${MARKER} rows in transactions.csv`).toHaveLength(2)
      const cash = (await (await live.budget()).repo.getAccounts()).find((a) => a.name === "Cash")
      for (const row of rows) {
        expect(row.amount).toBe(-500)
        expect(row.accountId).toBe(cash?.id)
        expect(row.datetime.slice(0, 10)).toBe(localDate())
      }
    })

    scenario("chat: multi-turn follow-up", async (live) => {
      expectDone(await live.chat(`How many ${MARKER} transactions did you just add? Answer with only the number.`))
    })

    scenario("chat: stop during tool batch, then send", async (live) => {
      const stopped = await live.chat(
        "Call list_accounts, list_categories, and list_transactions with limit 3 — all three — then give me a one-line summary.",
        (event) => event.type === "tool-result",
      )
      expectStopped(stopped)
      expect(stopped.toolResults, "a tool ran before Stop").not.toHaveLength(0)
      expectDone(await live.chat("Never mind. Which of my accounts holds the most money? One short sentence."))
    })

    scenario("chat: stop mid-text, then continue", async (live) => {
      const stopped = await live.chat(
        "Count from 1 to 40, one number per line, no other text.",
        (event) => event.type === "content" && event.blocks.some((b) => b.type === "text" && b.content.trim() !== ""),
      )
      expectStopped(stopped)
      expectDone(await live.chat("continue"))
    })

    const noImport = canImport(target.provider) ? null : `${target.provider} has no structured import (canImport is false)`
    const noPdf = canReadPdf(target.provider) ? null : `${target.provider} can't read PDFs (canReadPdf is false)`

    scenario("import: csv mapping", async (live) => {
      const importer = await live.importer()
      await importer.staging.clear()
      await importer.staging.writeSource("statement.csv", await readFile(join(FIXTURES_DIR, "statement.csv"), "utf-8"))
      const run = await importer.run("start", { stopAtPhase: "categorizing" })
      expectClean(run)
      expectCents(run.rows, [-4820, -1549, -675])
      expect(run.rows.map((r) => r.date).sort()).toEqual(["2026-09-26", "2026-09-27", "2026-09-29"])
    }, noImport)

    scenario("import: categorize batch", async (live) => {
      const importer = await live.importer()
      const staged = await importer.staging.readTransactions()
      if (!staged?.rows.length) throw new Error("no staged rows — depends on the csv mapping scenario")
      const run = await importer.run("enrich")
      expectClean(run)
      const categoryIds = new Set((await (await live.budget()).repo.getCategories()).map((c) => c.id))
      for (const row of run.rows) {
        expect(needsEnrich(row), `row ${row.id} still needs enrichment`).toBe(false)
        expect(categoryIds.has(row.categoryId), `row ${row.id} category ${row.categoryId}`).toBe(true)
      }
    }, noImport)

    scenario("import: pdf statement", async (live) => {
      const importer = await live.importer()
      await importer.staging.clear()
      await importer.staging.writeSource("statement.pdf", await readFile(join(FIXTURES_DIR, "statement.pdf"), "base64"))
      const run = await importer.run("start", { stopAtPhase: "categorizing" })
      expectClean(run)
      expectCents(run.rows, [-5432, -1890, 12000])
    }, noImport ?? noPdf)
  })
}

function expectDone(turn: Turn): void {
  if (turn.error) throw new Error(`error event: ${turn.error}`)
  expect(turn.outcome, "turn outcome").toBe("done")
}

function expectStopped(turn: Turn): void {
  if (turn.outcome === "error") throw new Error(`turn errored before Stop: ${turn.error}`)
  if (turn.error) throw new Error(`error event after Stop: ${turn.error}`)
  expect(turn.outcome, "turn outcome (Stop must land before the turn ends)").toBe("stopped")
}

function expectClean(run: ImportRun): void {
  if (run.error) throw new Error(`orchestrator error: ${run.error}`)
  expect(run.warnings, "orchestrator warnings").toEqual([])
}

function expectCents(rows: readonly { amount: number }[], expected: number[]): void {
  for (const row of rows) expect(Number.isInteger(row.amount), `amount ${row.amount} is integer cents`).toBe(true)
  expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual(expected)
}

function localDate(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
