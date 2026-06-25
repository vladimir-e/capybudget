import { redirect } from "@tanstack/react-router"
import { useAppStore } from "@/stores/app-store"
import { detectBudget } from "../../../../src/services/budget"

// Set the first time the launch is resolved, for the lifetime of the app
// process — NOT persisted, so a real restart re-arms it. The budget selector
// re-mounts every time the user closes a budget; without this guard the user
// would be re-redirected straight back into the launch budget and could never
// reach the selector to open a different one.
let resolved = false

/** Reset the once-guard. Test-only seam. */
export function resetLaunchResolution(): void {
  resolved = false
}

/**
 * Cold-start resolution for the index route's `beforeLoad`. Returns a redirect
 * to throw when a valid launch budget should auto-open, or null to fall through
 * to the selector. Fires at most once per app process.
 *
 * A validation failure (folder missing, unreadable budget.json, any error)
 * falls through WITHOUT clearing the pointer — the drive may be temporarily
 * unavailable, so the next launch retries.
 */
export async function resolveLaunchRedirect(): Promise<ReturnType<typeof redirect> | null> {
  if (resolved) return null
  // Claim the launch before any await so a duplicate/concurrent beforeLoad
  // can't slip past and double-fire.
  resolved = true

  const path = useAppStore.getState().launchBudgetPath
  if (!path) return null

  try {
    const meta = await detectBudget(path)
    if (!meta) return null
    // Mirror the selector's open flow so the launch budget's recents entry
    // (and its lastOpened) stays current, and use the name from budget.json
    // so a rename made outside the app is reflected.
    useAppStore.getState().addRecentBudget(path, meta.name)
    return redirect({ to: "/budget", search: { path, name: meta.name } })
  } catch {
    return null
  }
}
