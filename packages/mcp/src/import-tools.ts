/**
 * MCP tools for the import working directory (.capy/import/).
 *
 * These tools let the intelligence agent read and write files in the
 * import staging area without touching the budget data directly.
 */

import { mkdir, readFile, writeFile, appendFile, readdir } from "node:fs/promises"
import { join } from "node:path"

const IMPORT_DIR = ".capy/import"

async function resolveImportDir(budgetPath: string): Promise<string> {
  const dir = join(budgetPath, IMPORT_DIR)
  await mkdir(dir, { recursive: true })
  return dir
}

// ── Tool schemas ─────────────────────────────────────────────────

export const IMPORT_TOOLS = [
  {
    name: "read_import_file",
    description:
      "Read a file from the import working directory (.capy/import/). Use this to read previously normalized or enriched data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to read (e.g. 'transactions.csv')",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "write_import_file",
    description:
      "Write a file to the import working directory (.capy/import/). Overwrites if the file exists. Use this to write normalized transaction data as CSV.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to write (e.g. 'transactions.csv')",
        },
        content: {
          type: "string",
          description: "File content to write",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "append_import_file",
    description:
      "Append content to a file in the import working directory (.capy/import/). Creates the file if it doesn't exist.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description: "File name to append to",
        },
        content: {
          type: "string",
          description: "Content to append",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "list_import_files",
    description:
      "List files in the import working directory (.capy/import/).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const

// ── Tool handlers ────────────────────────────────────────────────

export async function handleReadImportFile(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, args.filename as string)
  return await readFile(filePath, "utf-8")
}

export async function handleWriteImportFile(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, args.filename as string)
  await writeFile(filePath, args.content as string, "utf-8")
  return JSON.stringify({ success: true, filename: args.filename })
}

export async function handleAppendImportFile(
  budgetPath: string,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  const filePath = join(dir, args.filename as string)
  await appendFile(filePath, args.content as string, "utf-8")
  return JSON.stringify({ success: true, filename: args.filename })
}

export async function handleListImportFiles(
  budgetPath: string,
): Promise<string> {
  const dir = await resolveImportDir(budgetPath)
  try {
    const files = await readdir(dir)
    return JSON.stringify(files)
  } catch {
    return JSON.stringify([])
  }
}
