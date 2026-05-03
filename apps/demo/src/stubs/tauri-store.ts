/** Stub for @tauri-apps/plugin-store — used in browser demo.
 *
 * Seeds an in-memory config that pre-selects the "claude-cli" provider.
 * The demo aliases `services/claude-cli-session` → `demo-claude-cli-session`,
 * so the factory ends up constructing the demo stub session — which is
 * what the demo wants, regardless of what's actually installed locally.
 */

const seeded = {
  provider: "claude-cli",
  anthropic: { apiKey: "", model: "claude-sonnet-4-5" },
  openai: { apiKey: "", model: "gpt-5" },
}

export const Store = {
  load: async (_path: string) => {
    const memory: Record<string, unknown> = { config: seeded }
    return {
      async get<T>(key: string): Promise<T | undefined> {
        return memory[key] as T | undefined
      },
      async set(key: string, value: unknown): Promise<void> {
        memory[key] = value
      },
      async save(): Promise<void> {},
    }
  },
}
