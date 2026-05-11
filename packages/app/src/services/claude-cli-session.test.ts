import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"

// ── Tauri shell mock ───────────────────────────────────────────────
//
// `Command.create(...)` returns an object with `.stdout.on('data')` /
// `.stderr.on('data')` / `.on('close' | 'error')` / `.spawn()` etc.
// The mock below lets each test capture handlers, then drive them
// synthetically — feeding stream-json lines through stdout, signalling
// process death via `close`, or routing surface errors via `error`.

interface MockCommandHandlers {
  stdout: ((line: string) => void) | null
  stderr: ((line: string) => void) | null
  close: ((data: { code: number | null }) => void) | null
  error: ((err: string) => void) | null
}

interface MockChild {
  write: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

const { latestHandlers, latestChild } = vi.hoisted(() => {
  const handlers: { current: MockCommandHandlers | null } = { current: null }
  const child: { current: MockChild | null } = { current: null }
  return {
    latestHandlers: handlers,
    latestChild: child,
  }
})

vi.mock("@tauri-apps/plugin-shell", () => {
  return {
    Command: {
      create: vi.fn(() => {
        const handlers: MockCommandHandlers = {
          stdout: null,
          stderr: null,
          close: null,
          error: null,
        }
        latestHandlers.current = handlers
        const child: MockChild = {
          write: vi.fn().mockResolvedValue(undefined),
          kill: vi.fn().mockResolvedValue(undefined),
        }
        latestChild.current = child
        return {
          stdout: { on: (_e: string, h: (line: string) => void) => { handlers.stdout = h } },
          stderr: { on: (_e: string, h: (line: string) => void) => { handlers.stderr = h } },
          on: (event: string, h: unknown) => {
            if (event === "close") handlers.close = h as (d: { code: number | null }) => void
            if (event === "error") handlers.error = h as (e: string) => void
          },
          spawn: vi.fn().mockResolvedValue(child),
        }
      }),
    },
  }
})

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@tauri-apps/api/path", () => ({
  tempDir: vi.fn().mockResolvedValue("/tmp"),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join("/")),
}))

// `__PROJECT_ROOT__` is a Vite define; tests run under Vitest which
// doesn't replace it. Stub the global so the spawn path works.
;(globalThis as unknown as { __PROJECT_ROOT__: string }).__PROJECT_ROOT__ = ""

import { ClaudeCliSession } from "./claude-cli-session"

function makeSession() {
  const events: StreamEvent[] = []
  const exitHandler = vi.fn()
  const session = new ClaudeCliSession({
    budgetPath: "/budget",
    mcpServerPath: "mcp/server.js",
    systemPrompt: "you are capy",
    onEvent: (e) => events.push(e),
    onExit: exitHandler,
  })
  return { session, events, exitHandler }
}

beforeEach(() => {
  latestHandlers.current = null
  latestChild.current = null
})

describe("ClaudeCliSession", () => {
  it("decodes stream-json stdout into typed StreamEvents", async () => {
    const { session, events } = makeSession()
    await session.send("hi")

    const handlers = latestHandlers.current!
    expect(handlers.stdout).toBeTruthy()

    handlers.stdout!(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      }),
    )
    handlers.stdout!(JSON.stringify({ type: "result" }))

    expect(events).toEqual([
      { type: "content", blocks: [{ type: "text", content: "Hello" }] },
      { type: "done" },
    ])
  })

  it("routes unexpected process death through onExit (not the event stream)", async () => {
    const { session, events, exitHandler } = makeSession()
    await session.send("hi")

    const handlers = latestHandlers.current!
    handlers.close!({ code: 1 })

    expect(exitHandler).toHaveBeenCalledTimes(1)
    // Process exit must NOT surface as a StreamEvent.error — that's a
    // separate signal the consumer handles via onExit.
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  it("suppresses onExit when the consumer initiated kill()", async () => {
    const { session, exitHandler } = makeSession()
    await session.send("hi")

    await session.kill()
    // Tauri fires 'close' after kill resolves — simulate that.
    const handlers = latestHandlers.current!
    handlers.close?.({ code: 0 })

    expect(exitHandler).not.toHaveBeenCalled()
  })

  it("surfaces a Tauri Command error event as a StreamEvent.error", async () => {
    const { session, events } = makeSession()
    await session.send("hi")

    const handlers = latestHandlers.current!
    handlers.error!("spawn failed: ENOENT")

    expect(events).toContainEqual({
      type: "error",
      message: "spawn failed: ENOENT",
    })
  })

  it("kills the subprocess and emits a budget-exhausted error after the per-session cap", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    const { session, events, exitHandler } = makeSession()
    await session.send("loop forever")

    const handlers = latestHandlers.current!
    const child = latestChild.current!

    // Feed SESSION_TOOL_CALL_BUDGET + 1 distinct tool_use IDs through
    // the cumulative-snapshot stream. Each "assistant" line carries one
    // new tool_use block so the dedup-by-ID counter ticks up.
    for (let i = 0; i <= SESSION_TOOL_CALL_BUDGET; i++) {
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: `tu-${i}`,
                name: "list_accounts",
                input: {},
              },
            ],
          },
        }),
      )
    }

    expect(child.kill).toHaveBeenCalled()
    const budgetErr = events.find(
      (e) => e.type === "error" && /budget exhausted/i.test(e.message),
    )
    expect(budgetErr).toBeTruthy()
    // The deliberate-kill flag must suppress the unexpected-death path.
    handlers.close?.({ code: 0 })
    expect(exitHandler).not.toHaveBeenCalled()
  })

  it("dedups tool_use IDs across cumulative assistant snapshots before counting", async () => {
    const { session, events } = makeSession()
    await session.send("hi")

    const handlers = latestHandlers.current!
    const child = latestChild.current!

    // Same tool_use appears in many lines (cumulative content) — it
    // should count exactly once. Loop 200 times: well past the budget
    // of 100, but with only ONE distinct ID it stays under cap.
    for (let i = 0; i < 200; i++) {
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "tu-same", name: "list_accounts", input: {} },
            ],
          },
        }),
      )
    }

    expect(child.kill).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === "error")).toBe(false)
  })
})
