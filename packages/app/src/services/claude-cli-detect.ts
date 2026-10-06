/**
 * Probe for the Claude Code CLI on the host machine.
 *
 * Runs `claude --version` via Tauri shell once per app session. A zero
 * exit code counts as installed; a version below `MIN_CLAUDE_CLI_VERSION`
 * (the release that added `--restricted`) is outdated. Output with no
 * `X.Y.Z (Claude Code)` line counts as ready, because some users alias
 * `claude` to a wrapper that prints its own version.
 *
 * The settings UI re-checks via `recheckClaudeCli()` when it opens,
 * so a user who installs Claude Code mid-session can pick it up
 * without restarting the app.
 */

import { Command } from "@tauri-apps/plugin-shell"

export type ClaudeCliStatus = "ready" | "outdated" | "missing"

export const MIN_CLAUDE_CLI_VERSION = "2.1.248"

let cached: ClaudeCliStatus | null = null
let inFlight: Promise<ClaudeCliStatus> | null = null

async function probe(): Promise<ClaudeCliStatus> {
  try {
    const output = await Command.create("claude", ["--version"]).execute()
    if (output.code !== 0) return "missing"
    const version = /(\d+\.\d+\.\d+)\s*\(Claude Code\)/.exec(output.stdout)?.[1]
    return version && isOlder(version, MIN_CLAUDE_CLI_VERSION) ? "outdated" : "ready"
  } catch {
    return "missing"
  }
}

function isOlder(version: string, minimum: string): boolean {
  const a = version.split(".").map(Number)
  const b = minimum.split(".").map(Number)
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

export async function detectClaudeCli(): Promise<ClaudeCliStatus> {
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
export function recheckClaudeCli(): Promise<ClaudeCliStatus> {
  cached = null
  inFlight = null
  return detectClaudeCli()
}

/** Test-only: reset the module-local cache between unit tests. */
export function _resetClaudeCliCacheForTests(): void {
  cached = null
  inFlight = null
}
