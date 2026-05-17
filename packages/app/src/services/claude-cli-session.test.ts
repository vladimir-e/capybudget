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

  describe("cross-turn content accumulation", () => {
    it("accumulates blocks from successive turns into one cumulative cycle", async () => {
      // The CLI emits one `assistant` event per model turn, each
      // carrying only that turn's blocks. The session must stitch them
      // into a single cumulative array so a turn-2 render-table never
      // wipes a turn-1 donut chart from the UI.
      const { session, events } = makeSession()
      await session.send("breakdown")

      const handlers = latestHandlers.current!

      // Turn 1: text + donut chart.
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_turn1",
            content: [
              { type: "text", text: "Here's the split:" },
              {
                type: "tool_use",
                name: "mcp__capy__render_donut_chart",
                input: {
                  title: "Spending",
                  data: [{ label: "Food", value: 50 }],
                },
              },
            ],
          },
        }),
      )

      // Turn 2: a follow-up table (different message.id).
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_turn2",
            content: [
              {
                type: "tool_use",
                name: "mcp__capy__render_table",
                input: {
                  headers: ["Category", "Amount"],
                  rows: [["Food", "$50"]],
                },
              },
            ],
          },
        }),
      )

      const lastContent = [...events].reverse().find((e) => e.type === "content")
      expect(lastContent).toBeTruthy()
      if (lastContent?.type !== "content") throw new Error("unreachable")
      // Final cumulative emit must carry both the donut AND the table.
      const types = lastContent.blocks.map((b) => b.type)
      expect(types).toEqual(["text", "donut-chart", "table"])
    })

    it("grows the in-progress text block when same-id text deltas arrive", async () => {
      // The CLI streams text deltas as repeated `assistant` events with
      // the same `message.id`, each carrying the latest cumulative text
      // for the in-progress text block. The accumulator must replace,
      // not append, so streaming "Hel" → "Hello" doesn't emit two blocks.
      const { session, events } = makeSession()
      await session.send("hi")

      const handlers = latestHandlers.current!
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg_a", content: [{ type: "text", text: "He" }] },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg_a", content: [{ type: "text", text: "Hello" }] },
        }),
      )

      const lastContent = [...events].reverse().find((e) => e.type === "content")
      if (lastContent?.type !== "content") throw new Error("unreachable")
      expect(lastContent.blocks).toEqual([{ type: "text", content: "Hello" }])
    })

    it("preserves text when a same-id tool_use delta follows it", async () => {
      // Real wire format (verified empirically): within one message.id,
      // the CLI emits a text event then a SEPARATE tool_use event whose
      // content does NOT include the prior text. The accumulator must
      // append the tool block alongside the text, not clobber it. This
      // is the regression that caused the "text → tool replaces text"
      // cascade in the Claude CLI provider.
      const { session, events } = makeSession()
      await session.send("hi")

      const handlers = latestHandlers.current!
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg_a", content: [{ type: "text", text: "Hello." }] },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_a",
            content: [
              {
                type: "tool_use",
                name: "mcp__capy__list_accounts",
                input: {},
              },
            ],
          },
        }),
      )

      const lastContent = [...events].reverse().find((e) => e.type === "content")
      if (lastContent?.type !== "content") throw new Error("unreachable")
      expect(lastContent.blocks).toEqual([
        { type: "text", content: "Hello." },
        { type: "tool-activity", tool: "list_accounts" },
      ])
    })

    it("preserves prior turn when a new message.id starts (delta-style sequence)", async () => {
      // Full delta sequence: turn-1 text, turn-1 tool_use (same id),
      // then turn-2 text under a new id, then turn-2 render_table.
      // Final state must include all four blocks in order.
      const { session, events } = makeSession()
      await session.send("breakdown")

      const handlers = latestHandlers.current!

      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg_t1", content: [{ type: "text", text: "Querying…" }] },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_t1",
            content: [
              {
                type: "tool_use",
                name: "mcp__capy__list_transactions",
                input: {},
              },
            ],
          },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: { id: "msg_t2", content: [{ type: "text", text: "Here it is:" }] },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_t2",
            content: [
              {
                type: "tool_use",
                name: "mcp__capy__render_table",
                input: {
                  headers: ["Category", "Amount"],
                  rows: [["Food", "$50"]],
                },
              },
            ],
          },
        }),
      )

      const lastContent = [...events].reverse().find((e) => e.type === "content")
      if (lastContent?.type !== "content") throw new Error("unreachable")
      const types = lastContent.blocks.map((b) => b.type)
      expect(types).toEqual(["text", "tool-activity", "text", "table"])
    })

    it("resets the accumulator between sends so a new cycle starts clean", async () => {
      const { session, events } = makeSession()
      await session.send("first")

      const firstHandlers = latestHandlers.current!
      firstHandlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_t1",
            content: [{ type: "text", text: "first reply" }],
          },
        }),
      )
      firstHandlers.stdout!(JSON.stringify({ type: "result" }))

      // Second send — start fresh; previous content must NOT bleed in.
      events.length = 0
      await session.send("second")
      const secondHandlers = latestHandlers.current!
      secondHandlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            id: "msg_t2",
            content: [{ type: "text", text: "second reply" }],
          },
        }),
      )

      const lastContent = [...events].reverse().find((e) => e.type === "content")
      if (lastContent?.type !== "content") throw new Error("unreachable")
      expect(lastContent.blocks).toEqual([
        { type: "text", content: "second reply" },
      ])
    })
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
