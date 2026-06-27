// Owns crash recovery so the error UI doesn't have to: the one-shot
// "skip open-on-launch" marker, the restart action, and the last React
// component stack from a crash (route crashes expose it only via the router's
// onCatch, never as a prop — see bootstrap.tsx).

const SKIP_LAUNCH_KEY = "capy:skip-launch-redirect"

// Skip the open-on-launch redirect for the next load so a budget that crashes
// on open lands on the selector instead of looping back into the same crash.
// Session-scoped: survives the restart reload, clears on window close, so a
// genuine relaunch auto-opens as usual.
export function markSkipLaunchRedirect(): void {
  sessionStorage.setItem(SKIP_LAUNCH_KEY, "1")
}

export function consumeSkipLaunchRedirect(): boolean {
  if (!sessionStorage.getItem(SKIP_LAUNCH_KEY)) return false
  sessionStorage.removeItem(SKIP_LAUNCH_KEY)
  return true
}

// Reload the whole bundle and land on the selector (not the crashed route).
export function restartApp(): void {
  markSkipLaunchRedirect()
  window.location.assign("/")
}

let lastComponentStack: string | null = null

export function setCrashComponentStack(stack: string | null | undefined): void {
  lastComponentStack = stack ?? null
}

export function getCrashComponentStack(): string | null {
  return lastComponentStack
}
