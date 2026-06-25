import { redirect } from "@tanstack/react-router"
import { useAppStore } from "@/stores/app-store"
import { detectBudget } from "../../../../src/services/budget"

let resolved = false

export function resetLaunchResolution(): void {
  resolved = false
}

export async function resolveLaunchRedirect(): Promise<ReturnType<typeof redirect> | null> {
  if (resolved) return null
  resolved = true

  const path = useAppStore.getState().launchBudgetPath
  if (!path) return null

  try {
    const meta = await detectBudget(path)
    if (!meta) return null
    useAppStore.getState().addRecentBudget(path, meta.name)
    return redirect({ to: "/budget", search: { path, name: meta.name } })
  } catch {
    return null
  }
}
