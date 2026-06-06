import { describe, it, expect, beforeEach } from "vitest"
import { readStagingDuplicateTally } from "./import-state"
import { buildNothingToImportMessage, NOTHING_TO_IMPORT_SIGNAL } from "../prompts/dedup"
import { makeFileAdapter, makeMemoryFs, type MemoryFs } from "../tools/handlers/test-utils"

const BUDGET_PATH = "/budget"
const STAGING_PATH = `${BUDGET_PATH}/.capy/import/transactions.csv`
const HEADER =
  "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,targetAccountId,categoryId,categoryConfidence,duplicate,duplicateOf,duplicateConfidence"

let fs: MemoryFs

beforeEach(() => {
  fs = makeMemoryFs()
})

function setStaging(rows: string[]) {
  fs.files.set(STAGING_PATH, [HEADER, ...rows].join("\n"))
}

describe("readStagingDuplicateTally", () => {
  it("counts total rows and duplicate-marked rows", async () => {
    setStaging([
      "imp-1,2024-01-01,A,-100,expense,,,,,,,,,true,tx-1,high",
      "imp-2,2024-01-02,B,-200,expense,,,,,,,,,,,",
      "imp-3,2024-01-03,C,-300,expense,,,,,,,,,true,tx-2,low",
    ])

    const tally = await readStagingDuplicateTally(makeFileAdapter(fs), BUDGET_PATH)
    expect(tally).toEqual({ total: 3, duplicateCount: 2 })
  })

  it("reports every row a duplicate (the halt trigger)", async () => {
    setStaging([
      "imp-1,2024-01-01,A,-100,expense,,,,,,,,,true,tx-1,high",
      "imp-2,2024-01-02,B,-200,expense,,,,,,,,,true,tx-2,low",
    ])

    const tally = await readStagingDuplicateTally(makeFileAdapter(fs), BUDGET_PATH)
    expect(tally.total).toBe(2)
    expect(tally.duplicateCount).toBe(2)
  })

  it("returns zeroes for a missing staging file", async () => {
    const tally = await readStagingDuplicateTally(makeFileAdapter(fs), BUDGET_PATH)
    expect(tally).toEqual({ total: 0, duplicateCount: 0 })
  })

  it("returns zeroes for a header-only (empty) staging file", async () => {
    fs.files.set(STAGING_PATH, HEADER + "\n")
    const tally = await readStagingDuplicateTally(makeFileAdapter(fs), BUDGET_PATH)
    expect(tally).toEqual({ total: 0, duplicateCount: 0 })
  })
})

describe("buildNothingToImportMessage", () => {
  it("uses plural phrasing for multiple rows", () => {
    expect(buildNothingToImportMessage(23)).toBe(
      `All 23 transactions are ${NOTHING_TO_IMPORT_SIGNAL}.`,
    )
  })

  it("uses singular phrasing for one row", () => {
    expect(buildNothingToImportMessage(1)).toBe(
      `All 1 transaction is ${NOTHING_TO_IMPORT_SIGNAL}.`,
    )
  })
})
