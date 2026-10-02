import { describe, it, expect, vi, type Mock } from "vitest"
import { REPLY_TOOL_CALL_BUDGET } from "../../tools"
import type { ChatMessage, StreamEvent } from "../../types"
import { endingEvent } from "../agent-turn"
import { ClaudeCliSession, type ClaudeCliHost, type ClaudeCliProcessEvents, type ClaudeCliSpawnOptions } from "./claude-cli-session"

interface FakeProcess {
  args: readonly string[]
  options: ClaudeCliSpawnOptions
  events: ClaudeCliProcessEvents
  writes: string[]
  write: Mock<(data: string) => Promise<void>>
  kill: Mock<() => Promise<void>>
  say(event: Record<string, unknown>): void
}

function fakeHost() {
  const spawned: FakeProcess[] = []
  let failNextSpawn: Error | null = null
  const spawn = vi.fn<ClaudeCliHost["spawn"]>(async (args, options, events) => {
    if (failNextSpawn) {
      const err = failNextSpawn
      failNextSpawn = null
      throw err
    }
    const writes: string[] = []
    const proc: FakeProcess = {
      args,
      options,
      events,
      writes,
      write: vi.fn(async (data: string) => {
        writes.push(data)
      }),
      kill: vi.fn(async () => undefined),
      say: (event) => events.line(JSON.stringify(event)),
    }
    spawned.push(proc)
    return proc
  })
  const host: ClaudeCliHost = { projectRoot: "/repo", spawn }
  return {
    host,
    spawn,
    spawned,
    last: () => spawned[spawned.length - 1],
    failSpawn: (err: Error) => {
      failNextSpawn = err
    },
  }
}

function makeSession(model = "") {
  const events: StreamEvent[] = []
  const onExit = vi.fn()
  const fake = fakeHost()
  const session = new ClaudeCliSession(
    { budgetPath: "/budget", mcpServerPath: "mcp/server.ts", systemPrompt: "you are capy", model, onEvent: (e) => events.push(e), onExit },
    fake.host,
  )
  return { session, events, onExit, ...fake }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const TEXT = (text: string, id = "msg_1") => ({ type: "assistant", message: { id, content: [{ type: "text", text }] } })
const DONE = { type: "result", subtype: "success", is_error: false, stop_reason: "end_turn" }

function argValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

async function started(session: ClaudeCliSession, text: string) {
  let resolved = false
  const sent = session.send(text).then(() => {
    resolved = true
  })
  await flush()
  return { sent, isResolved: () => resolved }
}

describe("ClaudeCliSession", () => {
  describe("spawn", () => {
    it("keeps the user's own Claude Code setup out of Capy's session", async () => {
      const { session, last } = makeSession()
      await started(session, "hi")
      const { args, options } = last()
      expect(args).toContain("--strict-mcp-config")
      expect(argValue(args, "--tools")).toBe("Read")
      expect(argValue(args, "--allowedTools")).toBe("mcp__capy__*,Read")
      expect(argValue(args, "--setting-sources")).toBe("")
      expect(args).toContain("--disable-slash-commands")
      expect(args).toContain("--no-session-persistence")
      expect(options.env).toEqual({ ENABLE_TOOL_SEARCH: "false" })
    })

    it("confines Read to the budget folder by running there in restricted mode", async () => {
      const { session, last } = makeSession()
      await started(session, "hi")
      const { args, options } = last()
      expect(options.cwd).toBe("/budget")
      expect(args).toContain("--restricted")
      expect(args).not.toContain("--add-dir")
    })

    it("passes Capy's MCP server inline", async () => {
      const { session, last } = makeSession()
      await started(session, "hi")
      const { args } = last()
      expect(JSON.parse(argValue(args, "--mcp-config")!)).toEqual({
        mcpServers: {
          capy: { command: "/repo/node_modules/.bin/tsx", args: ["/repo/mcp/server.ts"], env: { BUDGET_PATH: "/budget" } },
        },
      })
      expect(argValue(args, "--system-prompt")).toBe("you are capy")
      expect(argValue(args, "--max-turns")).toBe(String(REPLY_TOOL_CALL_BUDGET))
    })

    it("passes --model only when one is configured", async () => {
      const unset = makeSession("")
      await started(unset.session, "hi")
      expect(unset.last().args).not.toContain("--model")

      const set = makeSession("opus")
      await started(set.session, "hi")
      expect(argValue(set.last().args, "--model")).toBe("opus")
    })

    it("spawns lazily and reuses the process across turns", async () => {
      const { session, spawned, last } = makeSession()
      expect(session.isAlive).toBe(false)
      const first = await started(session, "one")
      last().say(DONE)
      await first.sent
      const second = await started(session, "two")
      last().say(DONE)
      await second.sent
      expect(spawned).toHaveLength(1)
      expect(last().writes).toHaveLength(2)
      expect(JSON.parse(last().writes[0])).toEqual({ type: "user", message: { role: "user", content: "one" } })
      expect(session.isAlive).toBe(true)
    })
  })

  describe("turns", () => {
    it("streams a turn and resolves send when it ends", async () => {
      const { session, events, last } = makeSession()
      const turn = await started(session, "hi")
      last().say(TEXT("Hello"))
      expect(turn.isResolved()).toBe(false)
      last().say(DONE)
      await turn.sent
      expect(events).toEqual([{ type: "content", blocks: [{ type: "text", content: "Hello" }] }, { type: "done" }])
    })

    it("stamps the provider on endings that are errors", async () => {
      const { session, events, last } = makeSession()
      const turn = await started(session, "loop")
      last().say({ type: "result", subtype: "error_max_turns", is_error: true, errors: ["Reached maximum number of turns (100)"] })
      await turn.sent
      expect(events).toEqual([{ ...endingEvent("budgetExhausted"), provider: "claude-cli" }])
    })

    it("starts each turn's display clean", async () => {
      const { session, events, last } = makeSession()
      const first = await started(session, "one")
      last().say(TEXT("first reply", "m1"))
      last().say(DONE)
      await first.sent
      events.length = 0
      await started(session, "two")
      last().say(TEXT("second reply", "m2"))
      expect(events).toEqual([{ type: "content", blocks: [{ type: "text", content: "second reply" }] }])
    })

    it("ignores output that arrives between turns", async () => {
      const { session, events, last } = makeSession()
      const turn = await started(session, "one")
      last().say({ type: "assistant", message: { content: [{ type: "tool_use", id: "t", name: "mcp__capy__create_transaction", input: {} }] } })
      last().say(DONE)
      await turn.sent
      events.length = 0
      last().say({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t" }] } })
      expect(events).toEqual([])
    })

    it("holds the session until the result line, so a queued send never ends on the old turn's trailing output", async () => {
      const { session, events, last } = makeSession()
      const first = await started(session, "one")
      last().say({ type: "assistant", error: "invalid_request", message: { content: [{ type: "text", text: "Prompt is too long" }] } })
      expect(events).toEqual([{ type: "error", message: "Prompt is too long", provider: "claude-cli" }])
      const second = await started(session, "two")
      expect(first.isResolved()).toBe(false)
      expect(last().writes).toHaveLength(1)
      last().say(DONE)
      await first.sent
      await flush()
      expect(last().writes).toHaveLength(2)
      expect(second.isResolved()).toBe(false)
      expect(events).toHaveLength(1)
      last().say(TEXT("Real reply", "m2"))
      last().say(DONE)
      await second.sent
      expect(events.slice(1)).toEqual([{ type: "content", blocks: [{ type: "text", content: "Real reply" }] }, { type: "done" }])
    })

    it("discards the result line that trails a top-level error line", async () => {
      const { session, events, last } = makeSession()
      const first = await started(session, "one")
      last().say({ type: "error", error: { message: "Overloaded" } })
      const second = await started(session, "two")
      last().say(DONE)
      await first.sent
      await flush()
      expect(last().writes).toHaveLength(2)
      expect(second.isResolved()).toBe(false)
      last().say(TEXT("Real reply", "m2"))
      last().say(DONE)
      await second.sent
      expect(events).toEqual([
        { type: "error", message: "Overloaded", provider: "claude-cli" },
        { type: "content", blocks: [{ type: "text", content: "Real reply" }] },
        { type: "done" },
      ])
    })

    it("ends a process that never sends the result line after an early ending, and runs the queued send fresh", async () => {
      vi.useFakeTimers()
      try {
        const { session, onExit, spawned } = makeSession()
        let queuedAtExit: boolean | undefined
        onExit.mockImplementation(() => {
          queuedAtExit = session.hasQueuedSend
        })
        const first = session.send("one")
        await vi.advanceTimersByTimeAsync(0)
        spawned[0].say({ type: "error", error: { message: "Overloaded" } })
        const second = session.send("two")
        await vi.advanceTimersByTimeAsync(29_000)
        expect(spawned[0].kill).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1_000)
        await first
        expect(spawned[0].kill).toHaveBeenCalled()
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(queuedAtExit).toBe(true)
        expect(spawned).toHaveLength(2)
        expect(JSON.parse(spawned[1].writes[0]).message.content).toBe("two")
        spawned[0].events.exit(null)
        expect(onExit).toHaveBeenCalledTimes(1)
        spawned[1].say(DONE)
        await second
      } finally {
        vi.useRealTimers()
      }
    })

    it("leaves a turn that completes normally alone past the grace period", async () => {
      vi.useFakeTimers()
      try {
        const { session, onExit, spawned } = makeSession()
        const first = session.send("one")
        await vi.advanceTimersByTimeAsync(0)
        spawned[0].say({ type: "error", error: { message: "Overloaded" } })
        spawned[0].say(DONE)
        await first
        await vi.advanceTimersByTimeAsync(60_000)
        expect(spawned[0].kill).not.toHaveBeenCalled()
        expect(onExit).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it("queues a send behind the running turn", async () => {
      const { session, last } = makeSession()
      const first = await started(session, "one")
      const second = session.send("two")
      await flush()
      expect(session.hasQueuedSend).toBe(true)
      expect(last().writes).toHaveLength(1)
      last().say(DONE)
      await first.sent
      await flush()
      expect(session.hasQueuedSend).toBe(false)
      expect(last().writes).toHaveLength(2)
      last().say(DONE)
      await second
    })
  })

  describe("process exit", () => {
    it("routes an unexpected exit through onExit and ends the running turn", async () => {
      const { session, events, onExit, last } = makeSession()
      const turn = await started(session, "hi")
      last().events.exit(1)
      await turn.sent
      expect(onExit).toHaveBeenCalledTimes(1)
      expect(onExit).toHaveBeenCalledWith(undefined)
      expect(events).toEqual([])
      expect(session.isAlive).toBe(false)
    })

    it("passes the last stderr lines of an unexpected exit as its reason", async () => {
      const { session, onExit, last } = makeSession()
      const turn = await started(session, "hi")
      for (const line of ["warming up", "", "line two", "line three", "error: unknown option '--restricted'"]) last().events.stderr(line)
      last().events.exit(1)
      await turn.sent
      expect(onExit).toHaveBeenCalledWith("line two\nline three\nerror: unknown option '--restricted'")
    })

    it("gives no reason for a clean exit", async () => {
      const { session, onExit, last } = makeSession()
      const turn = await started(session, "hi")
      last().events.stderr("something chatty")
      last().events.exit(0)
      await turn.sent
      expect(onExit).toHaveBeenCalledWith(undefined)
    })

    it("leaves known harmless stderr lines out of the reason", async () => {
      const { session, onExit, last } = makeSession()
      const turn = await started(session, "hi")
      last().events.stderr("⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors")
      last().events.stderr("(node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. Please use a userland alternative instead.")
      last().events.stderr("(Use `node --trace-deprecation ...` to show where the warning was created)")
      last().events.exit(1)
      await turn.sent
      expect(onExit).toHaveBeenCalledWith(undefined)
    })

    it("still reports a crash after a max-turns ending, since the CLI survives it", async () => {
      const { session, onExit, last } = makeSession()
      const turn = await started(session, "loop")
      last().say({ type: "result", subtype: "error_max_turns", is_error: true })
      await turn.sent
      last().events.exit(1)
      expect(onExit).toHaveBeenCalledTimes(1)
    })

    it("respawns after a crash", async () => {
      const { session, spawned, last } = makeSession()
      const first = await started(session, "one")
      last().events.exit(1)
      await first.sent
      await started(session, "two")
      expect(spawned).toHaveLength(2)
      expect(spawned[1].writes).toHaveLength(1)
    })

    it("reports a failed spawn once, as an error event", async () => {
      const { session, events, onExit, failSpawn } = makeSession()
      failSpawn(new Error("program not found"))
      await session.send("hi")
      expect(events).toEqual([{ type: "error", message: "program not found", provider: "claude-cli" }])
      expect(onExit).not.toHaveBeenCalled()
    })

    it("reports a failed write once and drops the process", async () => {
      const { session, events, onExit, spawned } = makeSession()
      const turn = await started(session, "one")
      spawned[0].say(DONE)
      await turn.sent
      spawned[0].write.mockRejectedValueOnce(new Error("broken pipe"))
      await session.send("two")
      spawned[0].events.exit(1)
      expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: "broken pipe", provider: "claude-cli" }])
      expect(onExit).not.toHaveBeenCalled()
      expect(spawned[0].kill).toHaveBeenCalled()
      expect(session.isAlive).toBe(false)
    })
  })

  describe("stop", () => {
    it("kills the process, ends the turn quietly, and spawns fresh on the next send", async () => {
      const { session, events, onExit, spawned } = makeSession()
      const turn = await started(session, "one")
      await session.stop()
      await turn.sent
      spawned[0].events.exit(1)
      expect(spawned[0].kill).toHaveBeenCalled()
      expect(onExit).not.toHaveBeenCalled()
      expect(events).toEqual([])
      await started(session, "two")
      expect(spawned).toHaveLength(2)
    })

    it("keeps a stopped process's late output and exit out of the next turn", async () => {
      const { session, events, onExit, spawned } = makeSession()
      await started(session, "one")
      void session.stop()
      const next = await started(session, "two")
      spawned[0].say(TEXT("stale"))
      spawned[0].say(DONE)
      spawned[0].events.exit(1)
      expect(events).toEqual([])
      expect(onExit).not.toHaveBeenCalled()
      expect(next.isResolved()).toBe(false)
      expect(session.isAlive).toBe(true)
      spawned[1].say(TEXT("fresh"))
      spawned[1].say(DONE)
      await next.sent
      expect(events).toEqual([{ type: "content", blocks: [{ type: "text", content: "fresh" }] }, { type: "done" }])
    })

    it("cancels a send queued behind the stopped turn", async () => {
      const { session, spawned } = makeSession()
      await started(session, "one")
      const queued = session.send("two")
      expect(session.hasQueuedSend).toBe(true)
      await session.stop()
      await queued
      expect(session.hasQueuedSend).toBe(false)
      expect(spawned).toHaveLength(1)
      expect(spawned[0].writes).toHaveLength(1)
    })

    it("kills a process whose spawn finishes after Stop", async () => {
      const { session, spawn, spawned } = makeSession()
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const realSpawn = spawn.getMockImplementation()!
      spawn.mockImplementationOnce(async (...args) => {
        await gate
        return realSpawn(...args)
      })
      const sent = session.send("hi")
      await flush()
      await session.stop()
      release()
      await sent
      expect(spawned[0].kill).toHaveBeenCalled()
      expect(spawned[0].writes).toEqual([])
      expect(session.isAlive).toBe(false)
    })

    it("prepends the interrupted conversation to the next send, once", async () => {
      const { session, spawned } = makeSession()
      await started(session, "one")
      await session.stop()
      const prior: ChatMessage[] = [
        { id: "u", role: "user", blocks: [{ type: "text", content: "What did I spend?" }] },
        { id: "a", role: "assistant", blocks: [{ type: "text", content: "Let me check" }] },
      ]
      session.markInterrupted(prior)
      const second = await started(session, "two")
      const sentText = JSON.parse(spawned[1].writes[0]).message.content as string
      expect(sentText).toContain("[Previous conversation — the session was interrupted]")
      expect(sentText).toContain("User: What did I spend?")
      expect(sentText.endsWith("\ntwo")).toBe(true)
      spawned[1].say(DONE)
      await second.sent
      await started(session, "three")
      expect(JSON.parse(spawned[1].writes[1]).message.content).toBe("three")
    })

    it("drops the recovery context on restart", async () => {
      const { session, spawned } = makeSession()
      await started(session, "one")
      session.markInterrupted([{ id: "u", role: "user", blocks: [{ type: "text", content: "old" }] }])
      await session.restart()
      await started(session, "fresh")
      expect(JSON.parse(spawned[1].writes[0]).message.content).toBe("fresh")
    })
  })

  describe("kill", () => {
    it("ends the process for good: later sends are no-ops and nothing more is emitted", async () => {
      const { session, events, onExit, spawned } = makeSession()
      const turn = await started(session, "one")
      await session.kill()
      await turn.sent
      spawned[0].say(TEXT("late"))
      spawned[0].events.exit(1)
      await session.send("two")
      expect(spawned).toHaveLength(1)
      expect(events).toEqual([])
      expect(onExit).not.toHaveBeenCalled()
      expect(session.isAlive).toBe(false)
    })
  })
})
