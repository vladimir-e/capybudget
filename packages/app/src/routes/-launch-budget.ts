import { redirect } from "@tanstack/react-router"
import { useAppStore } from "@/stores/app-store"
import { detectBudget } from "../../../../src/services/budget"

let resolved = false

// Set by the error screen's Restart: skip the open-on-launch redirect for the
// next load so a budget that crashes on open lands on the selector instead of
// reopening into the same crash. Session-scoped, so a genuine relaunch (new
// window) auto-opens as usual.
export const SKIP_LAUNCH_REDIRECT_KEY = "capy:skip-launch-redirect"

export function resetLaunchResolution(): void {
  resolved = false
}

export async function resolveLaunchRedirect(): Promise<ReturnType<typeof redirect> | null> {
  if (resolved) return null
  resolved = true

  if (sessionStorage.getItem(SKIP_LAUNCH_REDIRECT_KEY)) {
    sessionStorage.removeItem(SKIP_LAUNCH_REDIRECT_KEY)
    return null
  }

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
