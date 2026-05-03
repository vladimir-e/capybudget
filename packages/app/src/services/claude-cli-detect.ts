/**
 * Probe for the Claude Code CLI on the host machine.
 *
 * Runs `claude --version` via Tauri shell once per app session. Any
 * zero exit code counts as "detected" — we deliberately don't parse
 * output strictly because some users alias `claude` to a local script.
 *
 * The settings UI re-checks via `recheckClaudeCli()` when it opens,
 * so a user who installs Claude Code mid-session can pick it up
 * without restarting the app.
 */

import { Command } from "@tauri-apps/plugin-shell"

let cached: boolean | null = null
let inFlight: Promise<boolean> | null = null

async function probe(): Promise<boolean> {
  try {
    const output = await Command.create("claude", ["--version"]).execute()
    return output.code === 0
  } catch {
    return false
  }
}

export async function detectClaudeCli(): Promise<boolean> {
  if (cached !== null) return cached
  if (!inFlight) {
    inFlight = probe().then((result) => {
      cached = result
      inFlight = null
      return result
    })
  }
  return inFlight
}

/** Bust the cache. Call when re-opening the settings UI. */
export function recheckClaudeCli(): Promise<boolean> {
  cached = null
  inFlight = null
  return detectClaudeCli()
}

/** Test-only: reset the module-local cache between unit tests. */
export function _resetClaudeCliCacheForTests(): void {
  cached = null
  inFlight = null
}
