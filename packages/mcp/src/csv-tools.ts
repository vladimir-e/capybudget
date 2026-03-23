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
  transformCsv,
  serializeImportCsv,
} from "@capybudget/core"

const IMPORT_DIR = ".capy/import"

async function resolveImportDir(budgetPath: string): Promise<string> {
  const dir = join(budgetPath, IMPORT_DIR)
  await mkdir(dir, { recursive: true })
  return dir
}

// ── Tool schemas ─────────────────────────────────────────────────

export const CSV_TOOLS = [
  {
    name: "analyze_csv",
    description:
      "Analyze a CSV file in the import directory. Returns: column headers, first 20 sample rows, total row count, and detected delimiter. Use this to understand the file format before defining a mapping.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "CSV file name in the import directory (e.g. 'source.csv')",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "preview_transform",
    description:
      "Apply a column mapping to the first N rows of a CSV file and return the transformed result. Use this to verify the mapping is correct before running the full transform. Returns transformed rows as JSON + any parse errors.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "CSV file name in the import directory",
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
      "Apply a column mapping to ALL rows of a CSV file and write the result as transactions.csv. This is the final step — use preview_transform first to verify the mapping. Returns stats: total rows, transformed, skipped, errored.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "Source CSV file name in the import directory",
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
  const dir = await resolveImportDir(budgetPath)
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
  const dir = await resolveImportDir(budgetPath)
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
  const dir = await resolveImportDir(budgetPath)
  const filePath = safeFilePath(dir, args.filename as string)
  const content = await readFile(filePath, "utf-8")
  const { data } = parseRawCsv(content)

  const mapping = args.mapping as CsvMapping
  const result = transformCsv(data, mapping)

  // Write the transformed CSV
  const csv = serializeImportCsv(result.transactions)
  const outPath = join(dir, "transactions.csv")
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
