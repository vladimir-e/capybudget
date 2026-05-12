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

  it("passes --max-turns to the CLI as the runaway-loop backstop", async () => {
    const { SESSION_TOOL_CALL_BUDGET } = await import("@capybudget/intelligence")
    const { Command } = await import("@tauri-apps/plugin-shell")
    const { session } = makeSession()
    await session.send("hi")

    const args = (Command.create as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const idx = args.indexOf("--max-turns")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe(String(SESSION_TOOL_CALL_BUDGET))
  })

  it("surfaces an error_max_turns result as an error event and suppresses onExit", async () => {
    // When `--max-turns` trips, the CLI emits an `error_max_turns`
    // result line, then exits cleanly. The parser turns the line into
    // an error event; the session must mark the teardown deliberate so
    // the close handler doesn't fire the unexpected-death onExit.
    const { session, events, exitHandler } = makeSession()
    await session.send("loop forever")

    const handlers = latestHandlers.current!
    handlers.stdout!(
      JSON.stringify({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        errors: ["Reached maximum number of turns (100)"],
      }),
    )

    expect(events).toContainEqual({
      type: "error",
      message: "Reached maximum number of turns (100)",
    })

    handlers.close?.({ code: 0 })
    expect(exitHandler).not.toHaveBeenCalled()
  })
})
