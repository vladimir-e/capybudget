import { describe, it, expect, vi, beforeEach } from "vitest"
import type { StreamEvent } from "@capybudget/intelligence"

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

// Vite define — Vitest doesn't replace it, so stub for the spawn path.
;(globalThis as unknown as { __PROJECT_ROOT__: string }).__PROJECT_ROOT__ = ""

import { ClaudeCliSession } from "./claude-cli-session"

function makeSession(model = "") {
  const events: StreamEvent[] = []
  const exitHandler = vi.fn()
  const session = new ClaudeCliSession({
    budgetPath: "/budget",
    mcpServerPath: "mcp/server.js",
    systemPrompt: "you are capy",
    model,
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
        message: {
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
        },
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
    expect(events.some((e) => e.type === "error")).toBe(false)
  })

  it("suppresses onExit when the consumer initiated kill()", async () => {
    const { session, exitHandler } = makeSession()
    await session.send("hi")

    await session.kill()
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
      provider: "claude-cli",
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

  it("omits --model when no model is configured (CLI default)", async () => {
    const { Command } = await import("@tauri-apps/plugin-shell")
    const create = Command.create as ReturnType<typeof vi.fn>
    create.mockClear()
    const { session } = makeSession("")
    await session.send("hi")

    const args = create.mock.calls[0][1] as string[]
    expect(args).not.toContain("--model")
  })

  it("passes --model when a model is configured", async () => {
    const { Command } = await import("@tauri-apps/plugin-shell")
    const create = Command.create as ReturnType<typeof vi.fn>
    create.mockClear()
    const { session } = makeSession("opus")
    await session.send("hi")

    const args = create.mock.calls[0][1] as string[]
    const idx = args.indexOf("--model")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe("opus")
  })

  it("passes --disallowedTools listing the CLI's stock built-ins to silence meta-narration", async () => {
    const { Command } = await import("@tauri-apps/plugin-shell")
    const { session } = makeSession()
    await session.send("hi")

    const args = (Command.create as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    const idx = args.indexOf("--disallowedTools")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe(
      "TodoWrite,Task,Bash,Edit,Write,Glob,Grep,WebFetch,WebSearch,NotebookEdit,KillBash,BashOutput",
    )
  })

  describe("cross-turn content accumulation", () => {
    it("accumulates blocks from successive turns into one cumulative cycle", async () => {
      const { session, events } = makeSession()
      await session.send("breakdown")

      const handlers = latestHandlers.current!

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
      const types = lastContent.blocks.map((b) => b.type)
      expect(types).toEqual(["text", "donut-chart", "table"])
    })

    it("grows the in-progress text block when same-id text deltas arrive", async () => {
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
            stop_reason: "end_turn",
          },
        }),
      )
      firstHandlers.stdout!(JSON.stringify({ type: "result" }))

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
      provider: "claude-cli",
    })

    handlers.close?.({ code: 0 })
    expect(exitHandler).not.toHaveBeenCalled()
  })

  describe("tool-result wire-up", () => {
    it("resolves tool name from the registry when a tool_result lands", async () => {
      const { session, events } = makeSession()
      await session.send("Add it.")

      const handlers = latestHandlers.current!

      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_01",
                name: "mcp__capy__create_transaction",
                input: {},
              },
            ],
          },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_01",
                content: "{\"success\":true}",
              },
            ],
          },
        }),
      )

      expect(events).toContainEqual({
        type: "tool-result",
        tool: "create_transaction",
        id: "toolu_01",
        ok: true,
      })
    })

    it("clears the registry on done so a reused id from the next turn doesn't false-hit", async () => {
      const { session, events } = makeSession()
      await session.send("first turn")

      const handlers = latestHandlers.current!

      handlers.stdout!(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_X",
                name: "mcp__capy__create_transaction",
                input: {},
              },
            ],
          },
        }),
      )
      handlers.stdout!(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "toolu_X", content: "ok" },
            ],
          },
        }),
      )
      handlers.stdout!(JSON.stringify({ type: "result" }))

      await session.send("second turn")
      handlers.stdout!(
        JSON.stringify({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "toolu_X", content: "stale" },
            ],
          },
        }),
      )

      // Registry was cleared after turn 1's `done`, so the reused id in turn 2
      // must not re-emit (no assistant turn re-registered it).
      const toolResults = events.filter((e) => e.type === "tool-result")
      expect(toolResults).toHaveLength(1)
      expect(toolResults[0]).toEqual({
        type: "tool-result",
        tool: "create_transaction",
        id: "toolu_X",
        ok: true,
      })
    })
  })
})
