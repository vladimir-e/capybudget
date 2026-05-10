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
import { DEFAULT_INTELLIGENCE_CONFIG, type CapySession } from "@capybudget/intelligence"

// ── Mock the session constructor ────────────────────────────────────
//
// `createSession` is what the lifecycle hook calls. We replace it with
// a factory that returns a fake `CapySession` whose `kill`/`stop` are
// vi.fn spies, and we keep a reference to every session it produced so
// the test can assert teardown.

interface FakeSession {
  session: CapySession
  killSpy: ReturnType<typeof vi.fn>
  sendSpy: ReturnType<typeof vi.fn>
  stopSpy: ReturnType<typeof vi.fn>
}

const { createdSessions, createSessionMock } = vi.hoisted(() => {
  const list: FakeSession[] = []
  const mock = vi.fn((): CapySession => {
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
    list.push({ session, killSpy, sendSpy, stopSpy })
    return session
  })
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
      useIntelligenceStore.getState().setAnthropicModel("claude-opus-4-7")
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

  it("kills the session when the provider goes to 'off'", () => {
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
      useIntelligenceStore.getState().setProvider("off")
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })
})
