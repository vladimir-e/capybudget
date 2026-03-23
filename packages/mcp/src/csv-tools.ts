/**
 * MCP tools for CSV analysis and programmatic transformation.
 *
 * These tools replace the old approach of having AI process every CSV row.
 * Instead: AI calls analyze_csv to see the format, defines a mapping,
 * previews it, then executes the full transform — all in code.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import Papa from "papaparse"
import {
  type CsvMapping,
  type Category,
  transformCsv,
  serializeImportCsv,
} from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"

const IMPORT_DIR = ".capy/import"
const SOURCES_DIR = ".capy/import/sources"

async function resolveImportDir(budgetPath: string): Promise<string> {
  const dir = join(budgetPath, IMPORT_DIR)
  await mkdir(dir, { recursive: true })
  return dir
}

async function resolveSourcesDir(budgetPath: string): Promise<string> {
  const dir = join(budgetPath, SOURCES_DIR)
  await mkdir(dir, { recursive: true })
  return dir
}

// ── Tool schemas ─────────────────────────────────────────────────

export const CSV_TOOLS = [
  {
    name: "analyze_csv",
    description:
      "Analyze a source CSV file in .capy/import/sources/. Returns: column headers, first 20 sample rows, total row count, and detected delimiter. Use this to understand the file format before defining a mapping.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name (e.g. '2019.csv'). Located in .capy/import/sources/.",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "preview_transform",
    description:
      "Apply a column mapping to the first N rows of a source CSV file and return the transformed result. Use this to verify the mapping is correct before running the full transform. Returns transformed rows as JSON + any parse errors.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name in .capy/import/sources/",
        },
        mapping: {
          type: "object",
          description: "The CsvMapping object defining how to transform columns",
        },
        limit: {
          type: "number",
          description: "Number of rows to preview (default: 10)",
        },
      },
      required: ["filename", "mapping"],
    },
  },
  {
    name: "transform_csv",
    description:
      "Apply a column mapping to ALL rows of a source CSV file and write the result as .capy/import/transactions.csv. This is the final step — use preview_transform first to verify the mapping. Returns stats: total rows, transformed, skipped, errored.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name in .capy/import/sources/",
        },
        mapping: {
          type: "object",
          description: "The CsvMapping object defining how to transform columns",
        },
      },
      required: ["filename", "mapping"],
    },
  },
  {
    name: "read_import_batch",
    description:
      "Read a batch of transactions from the import CSV (transactions.csv). Use this during enrichment to process transactions in manageable chunks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        offset: {
          type: "number",
          description: "Zero-based row offset to start reading from",
        },
        limit: {
          type: "number",
          description: "Number of rows to read (default: 100)",
        },
      },
      required: ["offset"],
    },
  },
  {
    name: "write_import_batch",
    description:
      "Write enriched transaction rows back to the import CSV, replacing specific rows by their offset range. The batch must have the same number of rows as the original range.",
    inputSchema: {
      type: "object" as const,
      properties: {
        offset: {
          type: "number",
          description: "Zero-based row offset where this batch starts",
        },
        rows: {
          type: "string",
          description: "CSV string of enriched rows (no header, same column order as transactions.csv)",
        },
      },
      required: ["offset", "rows"],
    },
  },
  {
    name: "auto_enrich",
    description:
      "Automatically enrich ALL imported transactions using code-based matching — no AI needed. Call this FIRST before any manual enrichment. Does three things: (1) maps sourceCategory to budget categories via fuzzy name matching, (2) matches sourceAccount to budget accounts, (3) fills in missing merchant names from descriptions. Processes all rows instantly. Returns stats on what was matched.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const

// ── Tool handlers ───────────────────────────────────────────────

function safeFilePath(dir: string, filename: string): string {
  if (!filename || filename.startsWith("/") || filename.includes("..")) {
    throw new Error(`Invalid filename: ${filename}`)
  }
  const filePath = join(dir, filename)
  if (!resolve(filePath).startsWith(resolve(dir) + "/")) {
    throw new Error(`Invalid filename: ${filename}`)
  }
  return filePath
}

function parseRawCsv(content: string): { data: Record<string, string>[]; meta: Papa.ParseMeta } {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  })
  return { data: result.data, meta: result.meta }
}

export async function handleAnalyzeCsv(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveSourcesDir(budgetPath)
  const filePath = safeFilePath(dir, args.filename as string)
  const content = await readFile(filePath, "utf-8")
  const { data, meta } = parseRawCsv(content)

  const sampleRows = data.slice(0, 20)

  return JSON.stringify({
    headers: meta.fields ?? [],
    delimiter: meta.delimiter,
    totalRows: data.length,
    sampleRows,
  }, null, 2)
}

export async function handlePreviewTransform(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveSourcesDir(budgetPath)
  const filePath = safeFilePath(dir, args.filename as string)
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const limit = (args.limit as number) || 10
  const sample = data.slice(0, limit)
  const mapping = args.mapping as CsvMapping

  const result = transformCsv(sample, mapping)

  return JSON.stringify({
    transactions: result.transactions,
    errors: result.errors,
    stats: result.stats,
    note: `Preview of first ${limit} rows. Call transform_csv to process all ${data.length} rows.`,
  }, null, 2)
}

export async function handleTransformCsv(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const sourcesDir = await resolveSourcesDir(budgetPath)
  const filePath = safeFilePath(sourcesDir, args.filename as string)
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const mapping = args.mapping as CsvMapping
  const result = transformCsv(data, mapping)

  // Write the transformed CSV to the import root (not sources/)
  const csv = serializeImportCsv(result.transactions)
  const importDir = await resolveImportDir(budgetPath)
  const outPath = join(importDir, "transactions.csv")
  await writeFile(outPath, csv, "utf-8")

  // Include first few errors for feedback
  const errorSample = result.errors.slice(0, 10)

  return JSON.stringify({
    success: true,
    stats: result.stats,
    errors: errorSample,
    moreErrors: result.errors.length > 10 ? result.errors.length - 10 : 0,
  }, null, 2)
}

// ── Batch enrichment handlers ────────────────────────────────────

const IMPORT_CSV_COLUMNS = [
  "id", "date", "description", "amount", "type",
  "sourceAccount", "sourceCategory", "memo",
  "merchant", "accountId", "categoryId", "categoryConfidence",
]

export async function handleReadImportBatch(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, "transactions.csv")
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const offset = args.offset as number
  const limit = (args.limit as number) || 100
  const batch = data.slice(offset, offset + limit)

  return JSON.stringify({
    offset,
    limit,
    totalRows: data.length,
    batchSize: batch.length,
    hasMore: offset + limit < data.length,
    rows: batch,
  }, null, 2)
}

export async function handleWriteImportBatch(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, "transactions.csv")
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const offset = args.offset as number
  const rowsCsv = args.rows as string

  // Parse the incoming enriched rows
  const enrichedResult = Papa.parse<Record<string, string>>(rowsCsv, {
    header: true,
    skipEmptyLines: true,
  })

  // If no header in incoming CSV, try headerless parse with known columns
  let enrichedRows: Record<string, string>[]
  if (enrichedResult.data.length > 0 && enrichedResult.meta.fields?.length === IMPORT_CSV_COLUMNS.length) {
    enrichedRows = enrichedResult.data
  } else {
    // Retry with known headers
    const withHeader = IMPORT_CSV_COLUMNS.join(",") + "\n" + rowsCsv
    const retry = Papa.parse<Record<string, string>>(withHeader, {
      header: true,
      skipEmptyLines: true,
    })
    enrichedRows = retry.data
  }

  // Replace rows in the original data
  for (let i = 0; i < enrichedRows.length; i++) {
    const targetIdx = offset + i
    if (targetIdx < data.length) {
      data[targetIdx] = enrichedRows[i]
    }
  }

  // Re-serialize and write
  const csv = Papa.unparse(data, { columns: IMPORT_CSV_COLUMNS })
  await writeFile(filePath, csv, "utf-8")

  return JSON.stringify({
    success: true,
    updatedRows: enrichedRows.length,
    offset,
  })
}

// ── Source category matching ──────────────────────────────────────

/**
 * Fuzzy-match sourceCategory strings to budget categories.
 * E.g. "Immediate Obligations: Groceries 🥑" → matches "Groceries".
 *
 * Strategy:
 * 1. Extract the last segment after ":" (most specific part)
 * 2. Strip emoji and whitespace
 * 3. Case-insensitive substring match against budget category names
 */
function matchSourceCategory(
  sourceCategory: string,
  categories: Category[],
): Category | null {
  if (!sourceCategory) return null

  // Extract the most specific part (after last ":")
  const parts = sourceCategory.split(":")
  const specific = parts[parts.length - 1]
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .trim()
    .toLowerCase()

  if (!specific) return null

  // Exact name match first
  for (const cat of categories) {
    if (cat.name.toLowerCase() === specific) return cat
  }

  // Substring: category name contained in source, or source contained in category name
  for (const cat of categories) {
    const catLower = cat.name.toLowerCase()
    if (specific.includes(catLower) || catLower.includes(specific)) return cat
  }

  // Word overlap: split both into words, count matches
  const sourceWords = new Set(specific.split(/\s+/).filter(w => w.length > 2))
  let bestMatch: Category | null = null
  let bestScore = 0

  for (const cat of categories) {
    const catWords = cat.name.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    let score = 0
    for (const word of catWords) {
      if (sourceWords.has(word)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = cat
    }
  }

  return bestScore > 0 ? bestMatch : null
}

export async function handleAutoEnrich(
  budgetPath: string,
  repo: BudgetRepository,
): Promise<string> {
  const importDir = await resolveImportDir(budgetPath)
  const filePath = join(importDir, "transactions.csv")
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const categories = await repo.getCategories()
  const activeCategories = categories.filter(c => !c.archived)
  const accounts = await repo.getAccounts()
  const activeAccounts = accounts.filter(a => !a.archived)

  const stats = {
    total: data.length,
    categoriesMatched: 0,
    accountsMatched: 0,
    merchantsSet: 0,
    categoriesAlreadySet: 0,
  }

  // ── 1. Source category → budget category ────────────────────
  const categoryCache = new Map<string, Category | null>()

  if (activeCategories.length > 0) {
    for (const row of data) {
      if (row.categoryId) {
        stats.categoriesAlreadySet++
        continue
      }
      const source = row.sourceCategory || ""
      if (!source) continue

      if (!categoryCache.has(source)) {
        categoryCache.set(source, matchSourceCategory(source, activeCategories))
      }
      const match = categoryCache.get(source)
      if (match) {
        row.categoryId = match.id
        row.categoryConfidence = "low"
        stats.categoriesMatched++
      }
    }
  }

  // ── 2. Source account → budget account ──────────────────────
  const accountCache = new Map<string, string | null>()

  if (activeAccounts.length > 0) {
    for (const row of data) {
      if (row.accountId) continue
      const source = row.sourceAccount || ""
      if (!source) continue

      if (!accountCache.has(source)) {
        accountCache.set(source, matchAccount(source, activeAccounts))
      }
      const match = accountCache.get(source)
      if (match) {
        row.accountId = match
        stats.accountsMatched++
      }
    }
  }

  // ── 3. Fill missing merchants from description ─────────────
  for (const row of data) {
    if (row.merchant) continue
    // Use description as merchant if it's not empty
    const desc = (row.description || "").trim()
    if (desc) {
      row.merchant = desc
      stats.merchantsSet++
    }
  }

  // ── Write back ──────────────────────────────────────────────
  const csv = Papa.unparse(data, { columns: IMPORT_CSV_COLUMNS })
  await writeFile(filePath, csv, "utf-8")

  const categoryMappings: Record<string, string> = {}
  for (const [source, cat] of categoryCache) {
    if (cat) categoryMappings[source] = `${cat.group}: ${cat.name}`
  }

  return JSON.stringify({
    success: true,
    stats,
    categoryMappings,
    unmatchedCategories: [...categoryCache.entries()]
      .filter(([, v]) => v === null)
      .map(([k]) => k),
    accountMappings: Object.fromEntries(
      [...accountCache.entries()].filter(([, v]) => v !== null),
    ),
  }, null, 2)
}

function matchAccount(
  sourceAccount: string,
  accounts: { id: string; name: string }[],
): string | null {
  const sourceLower = sourceAccount.toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .trim()

  // Exact match
  for (const acc of accounts) {
    const accLower = acc.name.toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .trim()
    if (sourceLower === accLower) return acc.id
  }

  // Substring match
  for (const acc of accounts) {
    const accLower = acc.name.toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .trim()
    if (sourceLower.includes(accLower) || accLower.includes(sourceLower)) return acc.id
  }

  return null
}
