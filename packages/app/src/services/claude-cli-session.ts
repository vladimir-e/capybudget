import { Command } from "@tauri-apps/plugin-shell"
import type { CapySession, ClaudeCliAdapterOptions } from "@capybudget/intelligence"
import { ClaudeCliSession, type ClaudeCliHost } from "@capybudget/intelligence/adapters"

declare const __PROJECT_ROOT__: string

const tauriHost: ClaudeCliHost = {
  projectRoot: __PROJECT_ROOT__,
  async spawn(args, { cwd, env }, events) {
    const command = Command.create("claude", [...args], { cwd, env: { ...env } })
    const diagnostic = (line: string) => {
      console.debug("[claude-cli]", line)
      events.stderr(line)
    }
    command.stdout.on("data", events.line)
    command.stderr.on("data", diagnostic)
    command.on("error", diagnostic)
    command.on("close", ({ code }) => events.exit(code))
    return command.spawn()
  },
}

export function createClaudeCliSession(opts: ClaudeCliAdapterOptions): CapySession {
  return new ClaudeCliSession(opts, tauriHost)
}
