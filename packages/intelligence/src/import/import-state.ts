/**
 * Read/write the import run's `enriched` flag in `.capy/import/state.json`,
 * plus the deterministic staging-CSV duplicate tally the orchestrator uses to
 * decide the dedup halt.
 *
 * Owned here (next to the run pipeline) rather than in a React hook because
 * the orchestrator persists run-completion side-effects itself — it can't
 * wait for a preview component to mount and register a callback. The UI's
 * `use-import-repository` reads the same file for the `sourceFiles` it owns.
 */

import Papa from "papaparse"
import type { FileAdapter } from "@capybudget/persistence"

const STATE_PATH_REL = ".capy/import/state.json"
const STAGING_PATH_REL = ".capy/import/transactions.csv"

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

/** A staging-CSV duplicate tally — the input to the dedup halt decision. */
export interface StagingDuplicateTally {
  total: number
  duplicateCount: number
}

/**
 * Count staging rows and how many carry `duplicate=true`, read straight from
 * the staging CSV. This is the orchestrator's deterministic halt input: after
 * the dedup phase (high-confidence auto-marks + low-confidence agent marks all
 * persisted), `duplicateCount === total && total > 0` means the whole import
 * already exists in the budget — nothing to enrich, nothing to merge.
 *
 * A missing/empty staging file reads as `{ total: 0, duplicateCount: 0 }`, so
 * an empty run never trips the halt.
 */
export async function readStagingDuplicateTally(
  fileAdapter: FileAdapter,
  budgetPath: string,
): Promise<StagingDuplicateTally> {
  let content: string
  try {
    const path = await fileAdapter.join(budgetPath, STAGING_PATH_REL)
    content = await fileAdapter.readFile(path)
  } catch {
    return { total: 0, duplicateCount: 0 }
  }
  if (!content.trim()) return { total: 0, duplicateCount: 0 }

  const { data } = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })

  let duplicateCount = 0
  for (const row of data) {
    if (row.duplicate === "true") duplicateCount++
  }
  return { total: data.length, duplicateCount }
}
