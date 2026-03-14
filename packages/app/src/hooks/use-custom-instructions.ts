/**
 * Hook to read/write custom instructions for the Capy AI assistant.
 * Stored as capy-instructions.md in the budget folder.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { join as joinPath } from "@tauri-apps/api/path"

const INSTRUCTIONS_FILE = "capy-instructions.md"

interface UseCustomInstructionsReturn {
  instructions: string
  isLoading: boolean
  save: (text: string) => Promise<void>
}

export function useCustomInstructions(budgetPath: string): UseCustomInstructionsReturn {
  const [instructions, setInstructions] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const pathRef = useRef(budgetPath)
  pathRef.current = budgetPath

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const filePath = await joinPath(budgetPath, INSTRUCTIONS_FILE)
        const text = await readTextFile(filePath)
        if (!cancelled) setInstructions(text)
      } catch {
        // File doesn't exist yet — that's fine
        if (!cancelled) setInstructions("")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [budgetPath])

  const save = useCallback(async (text: string) => {
    const filePath = await joinPath(pathRef.current, INSTRUCTIONS_FILE)
    await writeTextFile(filePath, text)
    setInstructions(text)
  }, [])

  return { instructions, isLoading, save }
}
