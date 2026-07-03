import { redirect } from "@tanstack/react-router"
import { useAppStore } from "@/stores/app-store"
import { consumeSkipLaunchRedirect } from "@/lib/crash-recovery"
import { flagReopenFailure } from "@/lib/reopen-failure"
import { detectBudget } from "../../../../src/services/budget"

let resolved = false

export function resetLaunchResolution(): void {
  resolved = false
}

export async function resolveLaunchRedirect(): Promise<ReturnType<typeof redirect> | null> {
  if (resolved) return null
  resolved = true

  // The error screen's Restart sets this so a budget that crashes on open
  // lands on the selector instead of reopening into the same crash.
  if (consumeSkipLaunchRedirect()) return null

  const path = useAppStore.getState().launchBudgetPath
  if (!path) return null

  // Reopen failed: the auto-open contract is broken. Turn it off so the next
  // launch doesn't fail again (the user re-enables it in Settings), and flag a
  // one-time notice naming the budget — from recents, or the folder's basename.
  const failReopen = () => {
    const recent = useAppStore.getState().recentBudgets.find((b) => b.path === path)
    flagReopenFailure({
      path,
      name: recent?.name ?? path.split("/").filter(Boolean).pop() ?? path,
    })
    useAppStore.getState().setLaunchBudgetPath(null)
  }

  try {
    const meta = await detectBudget(path)
    if (!meta) {
      failReopen()
      return null
    }
    useAppStore.getState().addRecentBudget(path, meta.name)
    return redirect({ to: "/budget", search: { path, name: meta.name } })
  } catch {
    failReopen()
    return null
  }
}
