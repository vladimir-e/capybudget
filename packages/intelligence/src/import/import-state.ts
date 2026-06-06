/**
 * Read/write the import run's `enriched` flag in `.capy/import/state.json`.
 *
 * Owned here (next to the run pipeline) rather than in a React hook because
 * the orchestrator persists run-completion side-effects itself — it can't
 * wait for a preview component to mount and register a callback. The UI's
 * `use-import-repository` reads the same file for the `sourceFiles` it owns.
 */

import type { FileAdapter } from "@capybudget/persistence"

const STATE_PATH_REL = ".capy/import/state.json"

async function resolveStatePath(
  fileAdapter: FileAdapter,
  budgetPath: string,
): Promise<string> {
  return fileAdapter.join(budgetPath, STATE_PATH_REL)
}

async function readState(
  fileAdapter: FileAdapter,
  budgetPath: string,
): Promise<Record<string, unknown>> {
  try {
    const path = await resolveStatePath(fileAdapter, budgetPath)
    const content = await fileAdapter.readFile(path)
    if (!content.trim()) return {}
    const parsed = JSON.parse(content)
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

/** Persist `enriched: true`, preserving any other fields (e.g. `sourceFiles`). */
export async function markImportEnriched(
  fileAdapter: FileAdapter,
  budgetPath: string,
): Promise<void> {
  const importDir = await fileAdapter.join(budgetPath, ".capy/import")
  await fileAdapter.mkdir(importDir, { recursive: true })
  const state = await readState(fileAdapter, budgetPath)
  const path = await resolveStatePath(fileAdapter, budgetPath)
  await fileAdapter.writeFile(path, JSON.stringify({ ...state, enriched: true }))
}

/** True when the import run has recorded a completed enrich phase. */
export async function readImportEnriched(
  fileAdapter: FileAdapter,
  budgetPath: string,
): Promise<boolean> {
  const state = await readState(fileAdapter, budgetPath)
  return state.enriched === true
}
