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
    name: "get_enrichment_targets",
    description:
      "Get unique descriptions that still need enrichment (no merchant or no categoryId). Returns a compact list of unique descriptions with their row count, amount range, and sourceCategory hint. Use this to understand what needs enrichment before applying rules.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "apply_enrichment_rules",
    description:
      "Apply enrichment rules to ALL matching transactions at once. Each rule matches by exact description and sets merchant and/or categoryId. Processes all rows instantly in code.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rules: {
          type: "array",
          description: "Array of enrichment rules to apply",
          items: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description: "Exact description to match (case-sensitive, as shown in get_enrichment_targets)",
              },
              merchant: {
                type: "string",
                description: "Clean merchant name to set",
              },
              categoryId: {
                type: "string",
                description: "Budget category UUID to assign",
              },
              categoryConfidence: {
                type: "string",
                description: "Confidence level: 'high' or 'low'",
              },
            },
            required: ["description"],
          },
        },
      },
      required: ["rules"],
    },
  },
  {
    name: "auto_enrich",
    description:
      "Automatically enrich ALL imported transactions using code-based matching — no AI needed. Call this FIRST before any manual enrichment. Does: (1) maps sourceCategory to budget categories via fuzzy name matching, (2) matches sourceAccount to budget accounts. Processes all rows instantly. Returns stats on what was matched.",
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

// ── Rule-based enrichment handlers ───────────────────────────────

const IMPORT_CSV_COLUMNS = [
  "id", "date", "description", "amount", "type",
  "sourceAccount", "sourceCategory", "memo",
  "merchant", "accountId", "categoryId", "categoryConfidence",
]

export async function handleGetEnrichmentTargets(
  budgetPath: string,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, "transactions.csv")
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  // Group by description, only include rows that need work
  const groups = new Map<string, {
    count: number;
    needsMerchant: number;
    needsCategory: number;
    sourceCategory: string;
    amountMin: number;
    amountMax: number;
    sampleType: string;
  }>()

  let alreadyComplete = 0

  for (const row of data) {
    const hasMerchant = !!row.merchant
    const hasCategory = !!row.categoryId
    if (hasMerchant && hasCategory) {
      alreadyComplete++
      continue
    }

    const desc = row.description || "(empty)"
    const amount = Math.abs(parseInt(row.amount, 10) || 0)

    if (!groups.has(desc)) {
      groups.set(desc, {
        count: 0,
        needsMerchant: 0,
        needsCategory: 0,
        sourceCategory: row.sourceCategory || "",
        amountMin: amount,
        amountMax: amount,
        sampleType: row.type || "expense",
      })
    }

    const g = groups.get(desc)!
    g.count++
    if (!hasMerchant) g.needsMerchant++
    if (!hasCategory) g.needsCategory++
    if (amount < g.amountMin) g.amountMin = amount
    if (amount > g.amountMax) g.amountMax = amount
    // Keep first non-empty sourceCategory
    if (!g.sourceCategory && row.sourceCategory) g.sourceCategory = row.sourceCategory
  }

  // Sort by count descending (most common descriptions first)
  const targets = [...groups.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([desc, g]) => ({
      description: desc,
      count: g.count,
      needsMerchant: g.needsMerchant,
      needsCategory: g.needsCategory,
      sourceCategory: g.sourceCategory || undefined,
      amountRange: `${g.amountMin}–${g.amountMax} cents`,
      type: g.sampleType,
    }))

  return JSON.stringify({
    totalRows: data.length,
    alreadyComplete,
    uniqueDescriptions: targets.length,
    targets,
  }, null, 2)
}

interface EnrichmentRule {
  description: string;
  merchant?: string;
  categoryId?: string;
  categoryConfidence?: string;
}

export async function handleApplyEnrichmentRules(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, "transactions.csv")
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const rules = args.rules as EnrichmentRule[]

  // Index rules by exact description for O(1) lookup
  const ruleMap = new Map<string, EnrichmentRule>()
  for (const rule of rules) {
    ruleMap.set(rule.description, rule)
  }

  let merchantsSet = 0
  let categoriesSet = 0

  for (const row of data) {
    const desc = row.description || "(empty)"
    const rule = ruleMap.get(desc)
    if (!rule) continue

    if (rule.merchant && !row.merchant) {
      row.merchant = rule.merchant
      merchantsSet++
    }
    if (rule.categoryId && !row.categoryId) {
      row.categoryId = rule.categoryId
      row.categoryConfidence = rule.categoryConfidence || "low"
      categoriesSet++
    }
  }

  const csv = Papa.unparse(data, { columns: IMPORT_CSV_COLUMNS })
  await writeFile(filePath, csv, "utf-8")

  return JSON.stringify({
    success: true,
    rulesApplied: rules.length,
    merchantsSet,
    categoriesSet,
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
