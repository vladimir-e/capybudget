/**
 * Generic text-file reader for the agent.
 *
 * Mirrors the allow-list scope that the Claude CLI gets via
 * `--add-dir <budgetPath>`: any file at or beneath the budget folder is
 * fair game. Filenames may be a name relative to the budget folder
 * (`.capy/import/sources/2024.csv`) or to the import sources folder
 * (`2024.csv`). Absolute paths and `..` are rejected up-front; the
 * resolved path is then string-prefix-checked against the budget folder
 * to catch any escape that slipped past the syntactic rules.
 *
 * Claude CLI users already have a built-in `Read` tool, so this is
 * redundant for them. API adapters need it.
 */

import type { ToolContext } from "../dispatch"

const SOURCES_DIR_REL = ".capy/import/sources"

async function resolveCandidatePaths(
  ctx: ToolContext,
  filename: string,
): Promise<string[]> {
  // Try sources folder first, then the budget folder. The agent often
  // refers to source files by bare name; either works.
  const sources = await ctx.fileAdapter.join(ctx.budgetPath, SOURCES_DIR_REL, filename)
  const budget = await ctx.fileAdapter.join(ctx.budgetPath, filename)
  return [sources, budget]
}

function rejectUnsafeFilename(filename: unknown): string {
  if (typeof filename !== "string" || !filename) {
    throw new Error(`Invalid filename: ${String(filename)}`)
  }
  if (
    filename.startsWith("/") ||
    filename.startsWith("\\") ||
    filename.includes("..") ||
    /^[A-Za-z]:[\\/]/.test(filename) // Windows-style absolute (e.g. C:\, C:/)
  ) {
    throw new Error(`Invalid filename: ${filename}`)
  }
  return filename
}

export async function handleReadFile(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const filename = rejectUnsafeFilename(args.filename)
  const candidates = await resolveCandidatePaths(ctx, filename)

  // Re-validate by string-prefix on the joined path. If for some reason
  // the join collapsed `..` or returned something outside budgetPath,
  // bail. (Belt-and-suspenders given rejectUnsafeFilename.)
  for (const path of candidates) {
    if (!path.startsWith(ctx.budgetPath)) continue
    if (await ctx.fileAdapter.exists(path)) {
      return await ctx.fileAdapter.readFile(path)
    }
  }

  throw new Error(`File not found: ${filename}`)
}
