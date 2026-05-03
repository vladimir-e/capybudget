/** Stub for @tauri-apps/plugin-shell — used in browser demo. */

export async function open(_target: string): Promise<void> {
  // no-op in browser
}

// Minimal `Command` shape so the renamed app code (claude-cli detect,
// future adapters) can import without crashing in the browser. The
// demo never actually spawns subprocesses; `execute` resolves with a
// non-zero exit so `detectClaudeCli()` reports "not installed", which
// is the truthful answer in a browser context.
export const Command = {
  create: (_name: string, _args?: string[]) => ({
    async execute() {
      return { code: 127, stdout: "", stderr: "not available in demo" }
    },
    stdout: { on: (_ev: string, _cb: (line: string) => void) => {} },
    stderr: { on: (_ev: string, _cb: (line: string) => void) => {} },
    on: (_ev: string, _cb: unknown) => {},
    async spawn() {
      return {
        async write(_payload: string) {},
        async kill() {},
      }
    },
  }),
}

