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
    name: "auto_enrich",
    description:
      "Code-based enrichment: (1) maps sourceCategory → budget categories, (2) matches sourceAccount → budget accounts, (3) sets merchant from description for empty merchants. Call this FIRST.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "enrich_stats",
    description:
      "Returns a compact summary of enrichment progress: total rows, how many have merchants, categories, accounts, and how many still need work.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "enrich_sample",
    description:
      "Returns a small CSV sample of rows that still need enrichment. Use this to spot patterns, then apply bulk updates. Returns at most `limit` rows as CSV (default 20).",
    inputSchema: {
      type: "object" as const,
      properties: {
        field: {
          type: "string",
          description: "Which empty field to filter by: 'merchant', 'categoryId', or 'any' (default: 'any')",
        },
        limit: {
          type: "number",
          description: "Max rows to return (default: 20)",
        },
      },
    },
  },
  {
    name: "enrich_update",
    description:
      "Bulk update: set field(s) on all rows matching a condition. Like SQL UPDATE ... WHERE. Use this to apply patterns you spotted in enrich_sample.",
    inputSchema: {
      type: "object" as const,
      properties: {
        set: {
          type: "object",
          description: "Fields to set. Keys: merchant, categoryId, categoryConfidence, accountId. Example: {\"categoryId\": \"uuid\", \"categoryConfidence\": \"low\"}",
        },
        where: {
          type: "object",
          description: "Match condition. Keys: field (column name), equals (exact match) or contains (substring, case-insensitive). Example: {\"field\": \"sourceCategory\", \"contains\": \"Groceries\"}",
        },
      },
      required: ["set", "where"],
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

// ── Primitive enrichment tools ────────────────────────────────────

const IMPORT_CSV_COLUMNS = [
  "id", "date", "description", "amount", "type",
  "sourceAccount", "sourceCategory", "memo",
  "merchant", "accountId", "categoryId", "categoryConfidence",
]

async function readImportCsv(budgetPath: string) {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, "transactions.csv")
  const content = await readFile(filePath, "utf-8")
  return { data: parseRawCsv(content).data, filePath }
}

async function writeImportCsv(filePath: string, data: Record<string, string>[]) {
  const csv = Papa.unparse(data, { columns: IMPORT_CSV_COLUMNS })
  await writeFile(filePath, csv, "utf-8")
}

export async function handleEnrichStats(
  budgetPath: string,
): Promise<string> {
  const { data } = await readImportCsv(budgetPath)

  let withMerchant = 0, withCategory = 0, withAccount = 0, transfers = 0
  for (const row of data) {
    if (row.merchant) withMerchant++
    if (row.categoryId) withCategory++
    if (row.accountId) withAccount++
    if (row.type === "transfer") transfers++
  }

  const needCategory = data.length - withCategory - transfers

  return [
    `Total: ${data.length} rows`,
    `Merchants: ${withMerchant}/${data.length}`,
    `Categories: ${withCategory}/${data.length - transfers} (${transfers} transfers excluded)`,
    `Accounts: ${withAccount}/${data.length}`,
    needCategory > 0 ? `Still need category: ${needCategory}` : `All categorized!`,
  ].join("\n")
}

export async function handleEnrichSample(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { data } = await readImportCsv(budgetPath)
  const field = (args.field as string) || "any"
  const limit = (args.limit as number) || 20

  const needsWork = data.filter((row) => {
    if (field === "merchant") return !row.merchant
    if (field === "categoryId") return !row.categoryId && row.type !== "transfer"
    return (!row.merchant || !row.categoryId) && row.type !== "transfer"
  })

  const sample = needsWork.slice(0, limit)

  // Return compact CSV with only useful columns
  const header = "description,sourceCategory,amount,type,merchant,categoryId"
  const rows = sample.map((r) =>
    [r.description, r.sourceCategory, r.amount, r.type, r.merchant, r.categoryId]
      .map(v => csvEscapeField(v || ""))
      .join(",")
  )

  return [header, ...rows].join("\n")
}

function csvEscapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function handleEnrichUpdate(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { data, filePath } = await readImportCsv(budgetPath)
  const setFields = args.set as Record<string, string>
  const where = args.where as { field: string; equals?: string; contains?: string }

  const allowedFields = new Set(["merchant", "categoryId", "categoryConfidence", "accountId"])

  // Validate set fields
  for (const key of Object.keys(setFields)) {
    if (!allowedFields.has(key)) {
      return `Error: cannot set field "${key}". Allowed: ${[...allowedFields].join(", ")}`
    }
  }

  let updated = 0

  for (const row of data) {
    const value = (row[where.field] || "").toLowerCase()
    let matches = false

    if (where.equals !== undefined) {
      matches = value === where.equals.toLowerCase()
    } else if (where.contains !== undefined) {
      matches = value.includes(where.contains.toLowerCase())
    }

    if (!matches) continue

    // Only update fields that are currently empty (don't overwrite)
    let rowChanged = false
    for (const [key, val] of Object.entries(setFields)) {
      if (!row[key]) {
        row[key] = val
        rowChanged = true
      }
    }
    if (rowChanged) updated++
  }

  await writeImportCsv(filePath, data)

  return `Updated ${updated} rows.`
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
  const { data, filePath } = await readImportCsv(budgetPath)

  const categories = await repo.getCategories()
  const activeCategories = categories.filter(c => !c.archived)
  const accounts = await repo.getAccounts()
  const activeAccounts = accounts.filter(a => !a.archived)

  let categoriesMatched = 0, accountsMatched = 0, merchantsSet = 0

  // ── 1. Source category → budget category ────────────────────
  const sourceCatCache = new Map<string, Category | null>()

  if (activeCategories.length > 0) {
    for (const row of data) {
      if (row.categoryId || !row.sourceCategory) continue
      if (!sourceCatCache.has(row.sourceCategory)) {
        sourceCatCache.set(row.sourceCategory, matchSourceCategory(row.sourceCategory, activeCategories))
      }
      const match = sourceCatCache.get(row.sourceCategory)
      if (match) {
        row.categoryId = match.id
        row.categoryConfidence = "low"
        categoriesMatched++
      }
    }
  }

  // ── 2. Source account → budget account ──────────────────────
  const accountCache = new Map<string, string | null>()

  if (activeAccounts.length > 0) {
    for (const row of data) {
      if (row.accountId || !row.sourceAccount) continue
      if (!accountCache.has(row.sourceAccount)) {
        accountCache.set(row.sourceAccount, matchAccount(row.sourceAccount, activeAccounts))
      }
      const match = accountCache.get(row.sourceAccount)
      if (match) {
        row.accountId = match
        accountsMatched++
      }
    }
  }

  // ── 3. Merchant from description ───────────────────────────
  for (const row of data) {
    if (row.merchant || !row.description) continue
    row.merchant = row.description.trim()
    merchantsSet++
  }

  await writeImportCsv(filePath, data)

  // Compact stats as plain text
  let transfers = 0, uncategorized = 0
  for (const row of data) {
    if (row.type === "transfer") transfers++
    else if (!row.categoryId) uncategorized++
  }

  return [
    `Done. ${data.length} rows processed.`,
    `Categories matched: ${categoriesMatched} (from sourceCategory)`,
    `Accounts matched: ${accountsMatched}`,
    `Merchants set: ${merchantsSet} (from description)`,
    uncategorized > 0 ? `Still need category: ${uncategorized} rows` : `All non-transfer rows categorized!`,
  ].join("\n")
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
