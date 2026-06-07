/**
 * Tool handlers for CSV analysis and programmatic transformation, plus
 * the primitive enrichment helpers (auto_enrich, enrich_stats,
 * enrich_sample, enrich_update).
 *
 * The handlers replace the old "AI processes every CSV row" approach —
 * the agent calls analyze_csv to inspect, defines a mapping, previews
 * with a sample, then calls transform_csv to process all rows in code.
 * Enrichment then runs as a series of bulk SQL-UPDATE-style calls.
 *
 * All filesystem access goes through the `FileAdapter` on the
 * `ToolContext` so the same handlers serve both the MCP server (node fs)
 * and the in-process API adapters (Tauri fs in the renderer).
 */

import Papa from "papaparse"
import {
  type CsvMapping,
  type Category,
  transformCsv,
  serializeImportCsv,
} from "@capybudget/core"
import type { BudgetRepository } from "@capybudget/persistence"
import type { ToolContext } from "../dispatch"

const IMPORT_DIR_REL = ".capy/import"
const SOURCES_DIR_REL = ".capy/import/sources"

async function resolveImportDir({ fileAdapter, budgetPath }: ToolContext): Promise<string> {
  const dir = await fileAdapter.join(budgetPath, IMPORT_DIR_REL)
  await fileAdapter.mkdir(dir, { recursive: true })
  return dir
}

async function resolveSourcesDir({ fileAdapter, budgetPath }: ToolContext): Promise<string> {
  const dir = await fileAdapter.join(budgetPath, SOURCES_DIR_REL)
  await fileAdapter.mkdir(dir, { recursive: true })
  return dir
}

async function safeFilePath(
  ctx: ToolContext,
  dir: string,
  filename: unknown,
): Promise<string> {
  if (typeof filename !== "string" || !filename) {
    throw new Error(`Invalid filename: ${String(filename)}`)
  }
  if (
    filename.startsWith("/") ||
    filename.startsWith("\\") ||
    filename.includes("..") ||
    filename.includes("\\")
  ) {
    throw new Error(`Invalid filename: ${filename}`)
  }
  const filePath = await ctx.fileAdapter.join(dir, filename)
  const dirSep = filePath.slice(dir.length, dir.length + 1)
  if (!filePath.startsWith(dir) || (dirSep !== "/" && dirSep !== "\\")) {
    throw new Error(`Invalid filename: ${filename}`)
  }
  return filePath
}

function parseRawCsv(content: string): {
  data: Record<string, string>[]
  meta: Papa.ParseMeta
  errors: Papa.ParseError[]
} {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })
  return { data: result.data, meta: result.meta, errors: result.errors }
}

// ── analyze_csv / preview_transform / transform_csv ──────────────

export async function handleAnalyzeCsv(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveSourcesDir(ctx)
  const filePath = await safeFilePath(ctx, dir, args.filename)
  const content = await ctx.fileAdapter.readFile(filePath)

  // Parse only sample rows for efficiency on large files.
  const sampleResult = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
    preview: 20,
  })

  // Estimate total rows cheaply (count non-empty lines minus header).
  const totalRows = content.split("\n").filter((l) => l.trim().length > 0).length - 1

  return JSON.stringify(
    {
      headers: sampleResult.meta.fields ?? [],
      delimiter: sampleResult.meta.delimiter,
      totalRows: Math.max(0, totalRows),
      sampleRows: sampleResult.data,
      ...(sampleResult.errors.length > 0 && {
        parseErrors: sampleResult.errors.slice(0, 5),
      }),
    },
    null,
    2,
  )
}

export async function handlePreviewTransform(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveSourcesDir(ctx)
  const filePath = await safeFilePath(ctx, dir, args.filename)
  const content = await ctx.fileAdapter.readFile(filePath)
  const { data, errors: parseErrors } = parseRawCsv(content)

  const limit = (args.limit as number) || 10
  const sample = data.slice(0, limit)
  const mapping = args.mapping as CsvMapping

  const result = transformCsv(sample, mapping)

  return JSON.stringify(
    {
      transactions: result.transactions,
      errors: result.errors,
      stats: result.stats,
      note: `Preview of first ${limit} rows. Call transform_csv to process all ${data.length} rows.`,
      ...(parseErrors.length > 0 && { parseErrors: parseErrors.slice(0, 5) }),
    },
    null,
    2,
  )
}

export async function handleTransformCsv(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const sourcesDir = await resolveSourcesDir(ctx)
  const filePath = await safeFilePath(ctx, sourcesDir, args.filename)
  const content = await ctx.fileAdapter.readFile(filePath)
  const { data, errors: parseErrors } = parseRawCsv(content)

  const mapping = args.mapping as CsvMapping

  // Multi-file append: continue IDs from any existing transactions.csv.
  const importDir = await resolveImportDir(ctx)
  const outPath = await ctx.fileAdapter.join(importDir, "transactions.csv")
  let existingCsv = ""
  let startId = 1

  try {
    existingCsv = await ctx.fileAdapter.readFile(outPath)
    const { data: existingData } = parseRawCsv(existingCsv)
    for (const row of existingData) {
      const match = row.id?.match(/^imp-(\d+)$/)
      if (match) startId = Math.max(startId, parseInt(match[1], 10) + 1)
    }
  } catch {
    // No existing file — start fresh.
  }

  const result = transformCsv(data, mapping, { startId })

  const newCsv = serializeImportCsv(result.transactions)
  const finalCsv = existingCsv
    ? existingCsv.trimEnd() + "\n" + newCsv.split("\n").slice(1).join("\n")
    : newCsv
  await ctx.fileAdapter.writeFile(outPath, finalCsv)

  // Invalidate enrichment cache (per-context — see the enrichment cache
  // section below).
  invalidateEnrichmentCache(outPath)

  const errorSample = result.errors.slice(0, 10)

  return JSON.stringify(
    {
      success: true,
      stats: result.stats,
      errors: errorSample,
      moreErrors: result.errors.length > 10 ? result.errors.length - 10 : 0,
      ...(startId > 1 && { appended: true, startId }),
      ...(parseErrors.length > 0 && { parseErrors: parseErrors.slice(0, 5) }),
    },
    null,
    2,
  )
}

// ── Enrichment cache ─────────────────────────────────────────────
// Keyed on the resolved transactions.csv path so multiple budgets
// don't collide. The MCP server is single-budget so this is a single
// entry in practice; the renderer-side dispatch is also single-budget
// per session.

const csvCache = new Map<string, Record<string, string>[]>()

function invalidateEnrichmentCache(filePath: string): void {
  csvCache.delete(filePath)
}

/** Test hook — drops the entire enrichment cache. Production code
 *  invalidates per-path; tests need a clean slate between cases. */
export function __resetEnrichmentCacheForTests(): void {
  csvCache.clear()
}

async function readImportCsv(ctx: ToolContext) {
  const dir = await resolveImportDir(ctx)
  const filePath = await ctx.fileAdapter.join(dir, "transactions.csv")
  const cached = csvCache.get(filePath)
  if (cached) return { data: cached, filePath }
  const content = await ctx.fileAdapter.readFile(filePath)
  const data = parseRawCsv(content).data
  csvCache.set(filePath, data)
  return { data, filePath }
}

async function writeImportCsv(
  ctx: ToolContext,
  filePath: string,
  data: Record<string, string>[],
) {
  const csv = Papa.unparse(data, { columns: IMPORT_CSV_COLUMNS })
  await ctx.fileAdapter.writeFile(filePath, csv)
  csvCache.set(filePath, data)
}

const IMPORT_CSV_COLUMNS = [
  "id",
  "date",
  "description",
  "amount",
  "type",
  "sourceAccount",
  "sourceCategory",
  "merchant",
  "accountId",
  "targetAccountId",
  "categoryId",
  "categoryConfidence",
]

// ── enrich_stats / enrich_sample / enrich_update ─────────────────

export async function handleEnrichStats(ctx: ToolContext): Promise<string> {
  const { data } = await readImportCsv(ctx)

  let withMerchant = 0,
    withCategory = 0,
    withAccount = 0,
    transfers = 0,
    unmatchedTransfers = 0
  for (const row of data) {
    if (row.merchant) withMerchant++
    if (row.categoryId) withCategory++
    if (row.accountId) withAccount++
    if (row.type === "transfer") {
      transfers++
      if (!row.targetAccountId) unmatchedTransfers++
    }
  }

  const needCategory = data.length - withCategory - transfers

  // Transfers don't have merchants — the merge code clears them
  // (packages/core/src/import-merge.ts). Match that in the denominator
  // so "complete" means "every non-transfer row has a merchant".
  const transferSuffix =
    transfers > 0 ? ` (${transfers} transfers excluded)` : ""

  return [
    `Total: ${data.length} rows`,
    `Merchants: ${withMerchant}/${data.length - transfers}${transferSuffix}`,
    `Categories: ${withCategory}/${data.length - transfers}${transferSuffix}`,
    `Accounts: ${withAccount}/${data.length}`,
    needCategory > 0 ? `Still need category: ${needCategory}` : `All categorized!`,
    unmatchedTransfers > 0
      ? `Unmatched transfers: ${unmatchedTransfers} (will import as income/expense)`
      : ``,
  ]
    .filter(Boolean)
    .join("\n")
}

export async function handleEnrichSample(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const { data } = await readImportCsv(ctx)
  const field = (args.field as string) || "any"
  const limit = (args.limit as number) || 20

  const needsWork = data.filter((row) => {
    if (field === "merchant") return !row.merchant
    if (field === "categoryId") return !row.categoryId && row.type !== "transfer"
    if (field === "targetAccountId") return row.type === "transfer" && !row.targetAccountId
    return (!row.merchant || !row.categoryId) && row.type !== "transfer"
  })

  const sample = sampleEvenly(needsWork, limit)

  // Compact CSV with only useful columns — include targetAccountId for transfers.
  const isTransferQuery = field === "targetAccountId"
  const header = isTransferQuery
    ? "description,amount,type,sourceAccount,targetAccountId"
    : "description,sourceCategory,amount,type,merchant,categoryId"
  const rows = sample.map((r) =>
    (isTransferQuery
      ? [r.description, r.amount, r.type, r.sourceAccount, r.targetAccountId]
      : [r.description, r.sourceCategory, r.amount, r.type, r.merchant, r.categoryId]
    )
      .map((v) => csvEscapeField(v || ""))
      .join(","),
  )

  return [header, ...rows].join("\n")
}

/** Pick evenly-spaced items for a representative cross-section. */
function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  const step = items.length / count
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)])
}

function csvEscapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

type WhereCondition = { field: string; equals?: string; contains?: string }

export async function handleEnrichUpdate(
  ctx: ToolContext,
  args: Record<string, unknown>,
  repo?: BudgetRepository,
): Promise<string> {
  const { data, filePath } = await readImportCsv(ctx)
  const setFields = args.set as Record<string, string>
  const rawWhere = args.where as WhereCondition | WhereCondition[]

  const conditions: WhereCondition[] = Array.isArray(rawWhere) ? rawWhere : [rawWhere]

  const allowedFields = new Set([
    "merchant",
    "categoryId",
    "categoryConfidence",
    "accountId",
    "targetAccountId",
  ])

  for (const key of Object.keys(setFields)) {
    if (!allowedFields.has(key)) {
      return `Error: cannot set field "${key}". Allowed: ${[...allowedFields].join(", ")}`
    }
  }

  // Validate categoryId against real budget category UUIDs when set. The
  // model otherwise gets no signal that a stale or invented UUID was
  // silently ignored — the row would land uncategorized after a
  // "success" tool result.
  if (setFields.categoryId && repo) {
    const categories = await repo.getCategories()
    const known = new Set(categories.map((c) => c.id))
    if (!known.has(setFields.categoryId)) {
      return `Error: invalid categoryId "${setFields.categoryId}". Call list_categories to get valid IDs.`
    }
  }

  // Per-field counters so the model sees exactly what landed. Skipped
  // fields are equally informative — they signal "this field already
  // has a value", which tells the model to move on instead of retrying.
  const setCounts: Record<string, number> = {}
  const skippedCounts: Record<string, number> = {}
  for (const key of Object.keys(setFields)) {
    setCounts[key] = 0
    skippedCounts[key] = 0
  }
  let matched = 0

  for (const row of data) {
    const matches = conditions.every((cond) => {
      const value = (row[cond.field] || "").toLowerCase()
      if (cond.equals !== undefined) return value === cond.equals.toLowerCase()
      if (cond.contains !== undefined) return value.includes(cond.contains.toLowerCase())
      return false
    })

    if (!matches) continue
    matched++

    for (const [key, val] of Object.entries(setFields)) {
      if (!row[key]) {
        row[key] = val
        setCounts[key]++
      } else {
        skippedCounts[key]++
      }
    }
  }

  await writeImportCsv(ctx, filePath, data)

  if (matched === 0) {
    return `Matched 0 rows.`
  }

  const fieldLines = Object.keys(setFields).map(
    (key) =>
      `${key}: ${setCounts[key]} set, ${skippedCounts[key]} skipped (already populated)`,
  )
  return [`Matched ${matched} rows.`, ...fieldLines].join("\n")
}

// ── auto_enrich + matchers ───────────────────────────────────────

/**
 * Score-based fuzzy-match of sourceCategory strings to budget categories.
 * Handles colon-separated groups (e.g. "Immediate Obligations: Groceries") and emoji.
 *
 * Scoring: exact=100, substring=50+length ratio, word-overlap=10+overlap ratio.
 * Returns the best match above a minimum threshold.
 */
function matchSourceCategory(
  sourceCategory: string,
  categories: Category[],
): Category | null {
  if (!sourceCategory) return null

  const parts = sourceCategory.split(":")
  const specific = parts[parts.length - 1]
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .trim()
    .toLowerCase()

  if (!specific) return null

  let bestMatch: Category | null = null
  let bestScore = 0

  for (const cat of categories) {
    const catLower = cat.name.toLowerCase()
    let score = 0

    if (catLower === specific) {
      score = 100
    } else if (specific.includes(catLower)) {
      score = 50 + Math.round((catLower.length / specific.length) * 30)
    } else if (catLower.includes(specific)) {
      score = 50 + Math.round((specific.length / catLower.length) * 30)
    } else {
      const sourceWords = new Set(specific.split(/\s+/).filter((w) => w.length > 2))
      const catWords = catLower.split(/\s+/).filter((w) => w.length > 2)
      if (sourceWords.size > 0 && catWords.length > 0) {
        let overlap = 0
        for (const word of catWords) {
          if (sourceWords.has(word)) overlap++
        }
        if (overlap > 0) {
          score = 10 + Math.round((overlap / catWords.length) * 30)
        }
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = cat
    }
  }

  return bestScore >= 10 ? bestMatch : null
}

export async function handleAutoEnrich(
  ctx: ToolContext,
  repo: BudgetRepository,
): Promise<string> {
  const { data, filePath } = await readImportCsv(ctx)

  const categories = await repo.getCategories()
  const activeCategories = categories.filter((c) => !c.archived)
  const accounts = await repo.getAccounts()
  const activeAccounts = accounts.filter((a) => !a.archived)

  let categoriesMatched = 0,
    accountsMatched = 0,
    transferTargetsMatched = 0

  // 1. Source category → budget category
  const sourceCatCache = new Map<string, Category | null>()

  if (activeCategories.length > 0) {
    for (const row of data) {
      if (row.categoryId || !row.sourceCategory) continue
      if (!sourceCatCache.has(row.sourceCategory)) {
        sourceCatCache.set(
          row.sourceCategory,
          matchSourceCategory(row.sourceCategory, activeCategories),
        )
      }
      const match = sourceCatCache.get(row.sourceCategory)
      if (match) {
        row.categoryId = match.id
        row.categoryConfidence = "low"
        categoriesMatched++
      }
    }
  }

  // 2. Source account → budget account
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

  // 3. Transfer target account matching
  if (activeAccounts.length > 0) {
    for (const row of data) {
      if (row.type !== "transfer" || row.targetAccountId) continue
      const match = matchTransferTarget(row.description, row.accountId, activeAccounts)
      if (match) {
        row.targetAccountId = match
        transferTargetsMatched++
      }
    }
  }

  // Note: merchant is intentionally NOT populated from description here.
  // The raw description is the wrong value for Transaction.merchant —
  // it would propagate through to the final budget (Transaction has no
  // description field; raw text belongs in `note`). Cleaned merchant
  // names come from the model via enrich_update.

  await writeImportCsv(ctx, filePath, data)

  let uncategorized = 0
  for (const row of data) {
    if (row.type !== "transfer" && !row.categoryId) uncategorized++
  }

  let unmatchedTransfers = 0
  for (const row of data) {
    if (row.type === "transfer" && !row.targetAccountId) unmatchedTransfers++
  }

  return [
    `Done. ${data.length} rows processed.`,
    `Categories matched: ${categoriesMatched} (from sourceCategory)`,
    `Accounts matched: ${accountsMatched}`,
    `Transfer targets matched: ${transferTargetsMatched}`,
    uncategorized > 0
      ? `Still need category: ${uncategorized} rows`
      : `All non-transfer rows categorized!`,
    unmatchedTransfers > 0
      ? `Unmatched transfers: ${unmatchedTransfers} (will import as income/expense if not resolved)`
      : ``,
  ]
    .filter(Boolean)
    .join("\n")
}

// Common abbreviations found in bank transfer descriptions
const ACCOUNT_ABBREVIATIONS: Record<string, string[]> = {
  checking: ["chk", "chkg", "ckng"],
  savings: ["sav", "savg", "svng", "svg"],
  credit: ["cred", "cc", "crd"],
}

/**
 * Try to identify the target account for a transfer from its description.
 * Matches account names, abbreviations, and significant words against the description.
 * Excludes the source account to avoid self-referencing.
 */
function matchTransferTarget(
  description: string,
  sourceAccountId: string,
  accounts: { id: string; name: string }[],
): string | null {
  if (!description) return null
  const descLower = description.toLowerCase()

  for (const acc of accounts) {
    if (acc.id === sourceAccountId) continue
    const accLower = acc.name
      .toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .trim()
    if (!accLower) continue

    if (descLower.includes(accLower)) return acc.id

    const words = accLower.split(/\s+/).filter((w) => w.length >= 3)
    if (words.length > 0 && words.every((w) => descLower.includes(w))) return acc.id

    if (words.length > 0) {
      const allMatched = words.every((w) => {
        if (descLower.includes(w)) return true
        const abbrevs = ACCOUNT_ABBREVIATIONS[w]
        return abbrevs?.some((a) => descLower.includes(a)) ?? false
      })
      if (allMatched) return acc.id
    }
  }

  return null
}

function matchAccount(
  sourceAccount: string,
  accounts: { id: string; name: string }[],
): string | null {
  const sourceLower = sourceAccount
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
    .trim()

  for (const acc of accounts) {
    const accLower = acc.name
      .toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .trim()
    if (sourceLower === accLower) return acc.id
  }

  for (const acc of accounts) {
    const accLower = acc.name
      .toLowerCase()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .trim()
    if (sourceLower.includes(accLower) || accLower.includes(sourceLower)) return acc.id
  }

  return null
}
