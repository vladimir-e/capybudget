/**
 * Generic hook for reading/writing a file in the budget folder.
 * Handles load-with-fallback, cancellation, and save-to-disk.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { join as joinPath } from "@tauri-apps/api/path"

interface UseBudgetFileReturn<T> {
  data: T
  isLoading: boolean
  save: (value: T) => Promise<void>
}

export function useBudgetFile<T>(
  budgetPath: string,
  fileName: string,
  defaultValue: T,
  parse: (text: string) => T,
  format: (value: T) => string,
): UseBudgetFileReturn<T> {
  const [data, setData] = useState<T>(defaultValue)
  const [isLoading, setIsLoading] = useState(true)
  const pathRef = useRef(budgetPath)
  pathRef.current = budgetPath

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const filePath = await joinPath(budgetPath, fileName)
        const text = await readTextFile(filePath)
        if (!cancelled) setData(parse(text))
      } catch {
        // File doesn't exist yet — use defaults
        if (!cancelled) setData(defaultValue)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [budgetPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (value: T) => {
    const filePath = await joinPath(pathRef.current, fileName)
    await writeTextFile(filePath, format(value))
    setData(value)
  }, [fileName]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading, save }
}
