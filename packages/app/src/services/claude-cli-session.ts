import { Command } from "@tauri-apps/plugin-shell"
import type { CapySession, ClaudeCliAdapterOptions } from "@capybudget/intelligence"
import { ClaudeCliSession, type ClaudeCliHost } from "@capybudget/intelligence/adapters"

declare const __PROJECT_ROOT__: string

const tauriHost: ClaudeCliHost = {
  projectRoot: __PROJECT_ROOT__,
  async spawn(args, env, events) {
    const command = Command.create("claude", [...args], { env: { ...env } })
    command.stdout.on("data", events.line)
    command.stderr.on("data", (line: string) => console.debug("[claude-cli-stderr]", line))
    command.on("error", (message) => console.debug("[claude-cli-error]", message))
    command.on("close", () => events.exit())
    return command.spawn()
  },
}

export function createClaudeCliSession(opts: ClaudeCliAdapterOptions): CapySession {
  return new ClaudeCliSession(opts, tauriHost)
}
