/**
 * Regression test for `useCapySession`'s session-teardown effect.
 *
 * The hook must call `session.kill()` whenever the active provider or
 * its model changes — without this, `ensureSession()` short-circuits
 * on the still-populated `sessionRef` and routes the next user message
 * to the previous adapter (e.g. an old Claude CLI subprocess after
 * switching to Anthropic, or a session pinned to the previous model).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type CapySession,
  type StreamEvent,
} from "@capybudget/intelligence"

// ── Mock the session constructor ────────────────────────────────────
//
// `createSession` is what the lifecycle hook calls. We replace it with
// a factory that returns a fake `CapySession` whose `kill`/`stop` are
// vi.fn spies, captures the `onEvent` callback so tests can dispatch
// synthetic stream events, and keeps a reference to every session it
// produced so the test can assert teardown.

interface FakeSession {
  session: CapySession
  killSpy: ReturnType<typeof vi.fn>
  sendSpy: ReturnType<typeof vi.fn>
  stopSpy: ReturnType<typeof vi.fn>
  emit: (event: StreamEvent) => void
}

const { createdSessions, createSessionMock } = vi.hoisted(() => {
  const list: FakeSession[] = []
  const mock = vi.fn(
    (opts: { onEvent: (event: StreamEvent) => void }): CapySession => {
      const killSpy = vi.fn(async () => {})
      const sendSpy = vi.fn(async () => {})
      const stopSpy = vi.fn(async () => {})
      const restartSpy = vi.fn(async () => {})
      const session: CapySession = {
        isAlive: true,
        send: sendSpy,
        stop: stopSpy,
        restart: restartSpy,
        kill: killSpy,
      }
      list.push({ session, killSpy, sendSpy, stopSpy, emit: opts.onEvent })
      return session
    },
  )
  return { createdSessions: list, createSessionMock: mock }
})

vi.mock("@/services/create-session", () => ({
  createSession: createSessionMock,
}))

import { useCapySession } from "./use-capy-session"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
} from "@/stores/intelligence-store"

const baseOpts = {
  budgetPath: "/budget",
  budgetName: "personal",
  mcpServerPath: "mcp/server.js",
  currency: "USD",
}

beforeEach(() => {
  createdSessions.length = 0
  createSessionMock.mockClear()
  _resetIntelligenceStoreForTests()
})

afterEach(() => {
  _resetIntelligenceStoreForTests()
})

describe("useCapySession session teardown", () => {
  it("kills the running session when the provider changes", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))

    // Kick off a message — this spawns a session.
    act(() => {
      result.current.sendMessage("hi")
    })
    expect(createdSessions).toHaveLength(1)
    const firstSession = createdSessions[0]
    expect(firstSession.killSpy).not.toHaveBeenCalled()

    // Switch provider — the effect must tear the running session down.
    act(() => {
      useIntelligenceStore.setState({
        hydrated: true,
        config: {
          ...DEFAULT_INTELLIGENCE_CONFIG,
          provider: "anthropic",
          anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
        },
      })
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("clears the on-screen conversation when the provider or model changes", () => {
    // The new session has no memory of the prior turns, so carrying the old
    // messages forward would show a continuous thread the new model never saw.
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
      },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))

    // A user turn + the assistant's reply bubble are on screen.
    act(() => {
      result.current.sendMessage("what model are you?")
    })
    expect(result.current.messages.length).toBeGreaterThan(0)

    // Swap the model within the same provider — fresh chat.
    act(() => {
      useIntelligenceStore.getState().setAnthropicModel("claude-opus-4-8")
    })
    expect(result.current.messages).toEqual([])
  })

  it("kills the session when the Anthropic model changes", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
      },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))

    act(() => {
      result.current.sendMessage("hi")
    })
    expect(createdSessions).toHaveLength(1)
    const firstSession = createdSessions[0]

    // Swap Sonnet → Opus within the same provider.
    act(() => {
      useIntelligenceStore.getState().setAnthropicModel("claude-opus-4-8")
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("kills the session when the OpenAI model changes", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "sk-x", model: "gpt-5.4" },
      },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))

    act(() => {
      result.current.sendMessage("hi")
    })
    expect(createdSessions).toHaveLength(1)
    const firstSession = createdSessions[0]

    act(() => {
      useIntelligenceStore.getState().setOpenAiModel("gpt-5-pro")
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("kills the session when the Claude Code model changes", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "claude-cli",
        claudeCli: { model: "" },
      },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))

    act(() => {
      result.current.sendMessage("hi")
    })
    expect(createdSessions).toHaveLength(1)
    const firstSession = createdSessions[0]

    // Pick a specific CLI model — the signature shifts from
    // `claude-cli:` to `claude-cli:opus`, forcing a rebuild.
    act(() => {
      useIntelligenceStore.getState().setClaudeCliModel("opus")
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("does NOT kill the session when an unrelated model field changes", () => {
    // User is on Anthropic; the OpenAI model field changes (e.g. via
    // settings save). The running Anthropic session should be untouched.
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
      },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    const firstSession = createdSessions[0]

    act(() => {
      useIntelligenceStore.getState().setOpenAiModel("gpt-5-pro")
    })
    expect(firstSession.killSpy).not.toHaveBeenCalled()
  })

  it("kills the session when the provider goes to null", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })

    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    const firstSession = createdSessions[0]

    act(() => {
      useIntelligenceStore.getState().setProvider(null)
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })
})

describe("useCapySession live cache invalidation", () => {
  // Lightweight set-up: one Anthropic session, an onDataChanged spy,
  // and a helper to drive synthetic stream events through it.
  function setup() {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
      },
    })
    const onDataChanged = vi.fn()
    const onImportStarted = vi.fn()
    const { result } = renderHook(() =>
      useCapySession({ ...baseOpts, onDataChanged, onImportStarted }),
    )
    act(() => {
      result.current.sendMessage("do the thing")
    })
    const session = createdSessions[0]
    return { onDataChanged, onImportStarted, emit: session.emit, result }
  }

  it("fires onImportStarted when a start_import tool-result lands", () => {
    const { onImportStarted, onDataChanged, emit } = setup()

    act(() => {
      emit({ type: "tool-result", tool: "start_import", id: "tu_1", ok: true })
    })
    expect(onImportStarted).toHaveBeenCalledTimes(1)
    // start_import is not a budget mutation — it stages files, it doesn't edit data.
    expect(onDataChanged).not.toHaveBeenCalled()
  })

  it("does not fire onImportStarted when start_import reports failure", () => {
    const { onImportStarted, emit } = setup()

    act(() => {
      emit({ type: "tool-result", tool: "start_import", id: "tu_1", ok: false })
    })
    expect(onImportStarted).not.toHaveBeenCalled()
  })

  it("dedups duplicate start_import tool-results for the same call id", () => {
    const { onImportStarted, emit } = setup()

    act(() => {
      emit({ type: "tool-result", tool: "start_import", id: "tu_1", ok: true })
      emit({ type: "tool-result", tool: "start_import", id: "tu_1", ok: true })
    })
    expect(onImportStarted).toHaveBeenCalledTimes(1)
  })

  it("fires onDataChanged the moment a mutation tool-result lands", () => {
    const { onDataChanged, emit } = setup()

    // Model asks for the tool — block-level signal. No invalidation yet.
    act(() => {
      emit({
        type: "content",
        blocks: [{ type: "tool-activity", tool: "create_transaction" }],
      })
    })
    expect(onDataChanged).not.toHaveBeenCalled()

    // Tool finishes — invalidation fires immediately, not on `done`.
    act(() => {
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it("does not fire on a non-mutation tool-result", () => {
    const { onDataChanged, emit } = setup()

    act(() => {
      emit({
        type: "content",
        blocks: [{ type: "tool-activity", tool: "list_transactions" }],
      })
      emit({ type: "tool-result", tool: "list_transactions", id: "tu_1", ok: true })
    })
    expect(onDataChanged).not.toHaveBeenCalled()
  })

  it("does not fire when a mutation tool-result reports failure", () => {
    const { onDataChanged, emit } = setup()

    act(() => {
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: false })
    })
    expect(onDataChanged).not.toHaveBeenCalled()
  })

  it("dedups duplicate tool-result events for the same call id", () => {
    const { onDataChanged, emit } = setup()

    act(() => {
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it("fires once per distinct tool-result across the turn", () => {
    const { onDataChanged, emit } = setup()

    act(() => {
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
      emit({ type: "tool-result", tool: "update_transaction", id: "tu_2", ok: true })
      emit({ type: "done" })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(2)
  })

  it("done-fallback fires when a mutation was seen but no tool-result acked it", () => {
    const { onDataChanged, emit } = setup()

    // Mutation requested via tool-activity, but no tool-result arrives
    // (adapter bug, crash mid-tool, etc.). `done` should still trigger
    // the invalidation as defense-in-depth.
    act(() => {
      emit({
        type: "content",
        blocks: [{ type: "tool-activity", tool: "create_transaction" }],
      })
      emit({ type: "done" })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })

  it("done-fallback does NOT fire when per-call invalidation already ran", () => {
    const { onDataChanged, emit } = setup()

    act(() => {
      emit({
        type: "content",
        blocks: [{ type: "tool-activity", tool: "create_transaction" }],
      })
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
      emit({ type: "done" })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(1) // one, not two
  })

  it("resets per-turn state across sends", () => {
    const { onDataChanged, emit, result } = setup()

    // Turn 1: ack one mutation, then `done`.
    act(() => {
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
      emit({ type: "done" })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(1)

    // Turn 2: same id (different turn, but adapters reuse ids freely)
    // should fire again because the set was reset on send.
    act(() => {
      result.current.sendMessage("again")
    })
    act(() => {
      emit({ type: "tool-result", tool: "create_transaction", id: "tu_1", ok: true })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(2)
  })
})
