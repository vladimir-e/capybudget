/**
 * Tool handlers for the import working directory (.capy/import/).
 *
 * These tools let the agent read and write files in the import staging
 * area without touching the budget data directly. They run in two
 * environments — the MCP server (node fs FileAdapter) and the in-process
 * API adapters (Tauri fs FileAdapter) — through a single
 * `FileAdapter`-shaped interface.
 *
 * Path safety: filenames are restricted to a single segment inside
 * `.capy/import/`. We reject `..`, leading slashes, and backslashes
 * before joining, then validate the joined path starts with the import
 * directory's joined prefix. This works on every platform without
 * relying on a sync `path.resolve` (which Tauri's path API doesn't
 * expose).
 */

import type { ToolContext } from "../dispatch"

const IMPORT_DIR_REL = ".capy/import"

async function resolveImportDir({ fileAdapter, budgetPath }: ToolContext): Promise<string> {
  const dir = await fileAdapter.join(budgetPath, IMPORT_DIR_REL)
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
  // String-prefix check on the joined path catches any escape that
  // didn't trip the syntactic checks above. The trailing separator on
  // `dir` is reconstructed from the join result to stay platform-neutral.
  const dirSep = filePath.slice(dir.length, dir.length + 1)
  if (!filePath.startsWith(dir) || (dirSep !== "/" && dirSep !== "\\")) {
    throw new Error(`Invalid filename: ${filename}`)
  }
  return filePath
}

// ── Tool handlers ────────────────────────────────────────────────

export async function handleReadImportFile(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(ctx)
  const filePath = await safeFilePath(ctx, dir, args.filename)
  return await ctx.fileAdapter.readFile(filePath)
}

export async function handleWriteImportFile(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(ctx)
  const filePath = await safeFilePath(ctx, dir, args.filename)
  await ctx.fileAdapter.writeFile(filePath, String(args.content ?? ""))
  return JSON.stringify({ success: true, filename: args.filename })
}

export async function handleAppendImportFile(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const dir = await resolveImportDir(ctx)
  const filePath = await safeFilePath(ctx, dir, args.filename)
  await ctx.fileAdapter.appendFile(filePath, String(args.content ?? ""))
  return JSON.stringify({ success: true, filename: args.filename })
}

export async function handleListImportFiles(
  ctx: ToolContext,
): Promise<string> {
  const dir = await resolveImportDir(ctx)
  try {
    const entries = await ctx.fileAdapter.readDir(dir)
    return JSON.stringify(entries.filter((e) => e.isFile).map((e) => e.name))
  } catch {
    return JSON.stringify([])
  }
}
