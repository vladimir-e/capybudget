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
  type FileAttachment,
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
  exit: () => void
}

const { createdSessions, createSessionMock } = vi.hoisted(() => {
  const list: FakeSession[] = []
  const mock = vi.fn(
    (opts: { onEvent: (event: StreamEvent) => void; onExit?: () => void }): CapySession => {
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
      list.push({ session, killSpy, sendSpy, stopSpy, emit: opts.onEvent, exit: () => opts.onExit?.() })
      return session
    },
  )
  return { createdSessions: list, createSessionMock: mock }
})

vi.mock("@/services/create-session", () => ({
  createSession: createSessionMock,
}))

import { useCapySession, type UseCapySessionOptions } from "./use-capy-session"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _resetStoreForTests,
  _setStoreLoaderForTests,
} from "@/stores/intelligence-store"

const baseOpts: UseCapySessionOptions = {
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
  _resetStoreForTests()
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

  it("kills the session when the budget currency changes", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
      },
    })

    const { result, rerender } = renderHook((opts) => useCapySession(opts), {
      initialProps: baseOpts,
    })

    act(() => {
      result.current.sendMessage("hi")
    })
    expect(createdSessions).toHaveLength(1)
    const firstSession = createdSessions[0]

    // Currency is baked into the system prompt + snapshot, so a switch must
    // rebuild the session.
    rerender({ ...baseOpts, currency: "EUR" })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("kills the session when the active language changes", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-x", model: "claude-sonnet-4-6" },
      },
    })

    const { result, rerender } = renderHook((opts) => useCapySession(opts), {
      initialProps: baseOpts,
    })

    act(() => {
      result.current.sendMessage("hi")
    })
    expect(createdSessions).toHaveLength(1)
    const firstSession = createdSessions[0]

    rerender({ ...baseOpts, language: "Russian" })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("rebuilds the session when the API key is saved, without ever carrying the key in the signature", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-wrong", model: "claude-sonnet-4-6" },
      },
    })
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    const firstSession = createdSessions[0]

    act(() => {
      useIntelligenceStore.getState().setAnthropicKey("sk-right")
    })
    expect(firstSession.killSpy).toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
  })

  it("keeps an active chat when the API key of another provider is saved", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-ant", model: "claude-sonnet-4-6" },
      },
    })
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })

    act(() => {
      useIntelligenceStore.getState().setOpenAiKey("sk-openai")
    })
    expect(createdSessions[0].killSpy).not.toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(2)
  })

  it("keeps an active chat when the custom instructions change, and the next chat picks them up", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    const { result, rerender } = renderHook((props: UseCapySessionOptions) => useCapySession(props), {
      initialProps: { ...baseOpts, customInstructions: "Be brief." },
    })
    act(() => {
      result.current.sendMessage("hi")
    })
    const firstSession = createdSessions[0]

    rerender({ ...baseOpts, customInstructions: "Always show charts." })
    expect(firstSession.killSpy).not.toHaveBeenCalled()
    expect(result.current.messages).toHaveLength(2)

    act(() => {
      firstSession.emit({ type: "done" })
    })
    act(() => {
      result.current.newChat()
    })
    act(() => {
      result.current.sendMessage("hi again")
    })
    expect(createSessionMock.mock.calls.at(-1)?.[0]).toMatchObject({
      systemPrompt: expect.stringContaining("Always show charts."),
    })
  })

  it("rebuilds right away when the custom instructions change on an empty chat", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    const { result, rerender } = renderHook((props: UseCapySessionOptions) => useCapySession(props), {
      initialProps: { ...baseOpts, customInstructions: "Be brief." },
    })
    act(() => {
      result.current.sendMessage("hi")
    })
    const firstSession = createdSessions[0]
    ;(firstSession.session as { hasQueuedSend?: boolean }).hasQueuedSend = true
    act(() => {
      result.current.stopStreaming()
    })
    expect(result.current.messages).toEqual([])

    rerender({ ...baseOpts, customInstructions: "Always show charts." })
    expect(firstSession.killSpy).toHaveBeenCalled()
  })

  it("never cancels an early send when the instructions finish loading", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    const { result, rerender } = renderHook((props: UseCapySessionOptions) => useCapySession(props), {
      initialProps: { ...baseOpts, customInstructions: "" },
    })
    act(() => {
      result.current.sendMessage("hi")
    })

    rerender({ ...baseOpts, customInstructions: "Be brief." })
    expect(createdSessions[0].killSpy).not.toHaveBeenCalled()
    expect(result.current.isStreaming).toBe(true)
    expect(result.current.messages).toHaveLength(2)
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

  it.each([
    ["cutOff" as const, "Capy's reply was cut off before it finished. Try again, or ask for less at once."],
    ["refused" as const, "Capy declined to answer that one. Try rephrasing."],
  ])("words a %s error in the UI language instead of the adapter's fallback", (code, message) => {
    const { emit, result } = setup()

    act(() => {
      emit({ type: "error", code, message: "fallback" })
    })
    const blocks = result.current.messages.at(-1)?.blocks ?? []
    expect(blocks.at(-1)).toMatchObject({ type: "error", message })
  })

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
        blocks: [{ type: "tool-activity", tool: "create_transaction", status: "running" }],
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
        blocks: [{ type: "tool-activity", tool: "list_transactions", status: "running" }],
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
        blocks: [{ type: "tool-activity", tool: "create_transaction", status: "running" }],
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
        blocks: [{ type: "tool-activity", tool: "create_transaction", status: "running" }],
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

describe("useCapySession attachment content", () => {
  function setup() {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "sk-x", model: "gpt-5.5" },
      },
    })
    const { result } = renderHook(() => useCapySession(baseOpts))
    return { result }
  }

  const pdf: FileAttachment = {
    name: "statement.pdf",
    content: "JVBERi0xSECRET",
    size: 14,
    mediaType: "application/pdf",
  }

  it("sends a PDF as a document block with its base64 and filename, raw file alongside", () => {
    const { result } = setup()
    act(() => {
      result.current.sendMessage("import this", [pdf])
    })
    const [content, files] = createdSessions[0].sendSpy.mock.calls[0]
    const docBlock = (content as Array<{ type: string }>).find((b) => b.type === "document")
    expect(docBlock).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xSECRET" },
      filename: "statement.pdf",
    })
    // The raw file rides the second arg so start_import can stage the bytes.
    expect(files).toEqual([pdf])
  })

  it("never inlines PDF bytes into the text block", () => {
    const { result } = setup()
    act(() => {
      result.current.sendMessage("import this", [pdf])
    })
    const [content] = createdSessions[0].sendSpy.mock.calls[0]
    const textBlock = (content as Array<{ type: string; text?: string }>).find(
      (b) => b.type === "text",
    )
    expect(textBlock?.text).not.toContain("JVBERi0xSECRET")
  })
})

describe("useCapySession sends that never reach the model", () => {
  function lockedAnthropic() {
    const backend = {
      load: vi.fn(async () => null),
      loadSecrets: vi.fn(async () => ({ anthropic: "sk-loaded", openai: "" })),
      save: vi.fn(async () => {}),
      markGateSeen: vi.fn(async () => {}),
      clearGateSeen: vi.fn(async () => {}),
    }
    _setStoreLoaderForTests(async () => backend)
    useIntelligenceStore.setState({
      hydrated: true,
      secretGateSeen: false,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "", model: "claude-sonnet-4-6", keyPresent: true },
      },
    })
    return backend
  }

  const settle = () => act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("Stop while the key is still loading cancels the send and drops its bubbles", async () => {
    lockedAnthropic()
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    await vi.waitFor(() => expect(useIntelligenceStore.getState().secretGateOpen).toBe(true))
    act(() => {
      result.current.stopStreaming()
    })
    expect(useIntelligenceStore.getState().secretGateOpen).toBe(false)
    await settle()

    expect(createdSessions).toHaveLength(0)
    expect(result.current.messages).toEqual([])
  })

  it("New Chat while the key is still loading cancels the send", async () => {
    lockedAnthropic()
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    await vi.waitFor(() => expect(useIntelligenceStore.getState().secretGateOpen).toBe(true))
    act(() => {
      result.current.newChat()
    })
    expect(useIntelligenceStore.getState().secretGateOpen).toBe(false)
    await settle()

    expect(createdSessions).toHaveLength(0)
    expect(result.current.messages).toEqual([])
  })

  it("a dismissed key heads-up says the key is needed, not that Capy is unconfigured", async () => {
    lockedAnthropic()
    useIntelligenceStore.setState({ secretsError: true })
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    act(() => {
      useIntelligenceStore.getState().dismissSecretGate()
    })
    await settle()

    expect(result.current.messages.at(-1)?.blocks.at(-1)).toMatchObject({
      type: "error",
      message: "Capy needs your AI key to reply. Send again and choose Allow to unlock it.",
    })
    expect(result.current.isStreaming).toBe(false)
  })

  it("a failed keychain read says so", async () => {
    const backend = lockedAnthropic()
    backend.loadSecrets.mockRejectedValue(new Error("denied"))
    useIntelligenceStore.setState({ secretGateSeen: true })
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    await settle()

    expect(result.current.messages.at(-1)?.blocks.at(-1)).toMatchObject({
      type: "error",
      message: "Capy couldn't read your AI key from the system keychain. Send again to retry.",
    })
  })

  it("a New Chat after a failed send never closes a gate opened since", async () => {
    lockedAnthropic()
    const { result } = renderHook(() => useCapySession(baseOpts))
    act(() => {
      result.current.sendMessage("hi")
    })
    await vi.waitFor(() => expect(useIntelligenceStore.getState().secretGateOpen).toBe(true))
    act(() => {
      useIntelligenceStore.getState().dismissSecretGate()
    })
    await settle()

    void useIntelligenceStore.getState().ensureSecrets()
    await vi.waitFor(() => expect(useIntelligenceStore.getState().secretGateOpen).toBe(true))
    act(() => {
      result.current.newChat()
    })
    expect(useIntelligenceStore.getState().secretGateOpen).toBe(true)
  })

  it("a first send that never reached the model hands the budget snapshot to the next one", async () => {
    lockedAnthropic()
    const getBudgetSnapshot = vi.fn(() => undefined)
    const { result } = renderHook(() => useCapySession({ ...baseOpts, getBudgetSnapshot }))
    act(() => {
      result.current.sendMessage("hi")
    })
    act(() => {
      useIntelligenceStore.getState().dismissSecretGate()
    })
    await settle()

    act(() => {
      result.current.sendMessage("again")
    })
    act(() => {
      result.current.stopStreaming()
    })
    await settle()

    act(() => {
      result.current.sendMessage("third")
    })
    expect(getBudgetSnapshot).toHaveBeenCalledTimes(3)
  })

  it("a second Stop drops the bubbles of a send queued behind the stopped round", () => {
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
      result.current.sendMessage("first")
    })
    act(() => {
      result.current.stopStreaming()
    })
    const afterFirstStop = result.current.messages

    act(() => {
      result.current.sendMessage("second")
    })
    ;(createdSessions[0].session as { hasQueuedSend?: boolean }).hasQueuedSend = true
    act(() => {
      result.current.stopStreaming()
    })

    expect(result.current.messages).toEqual(afterFirstStop)
    expect(createdSessions[0].stopSpy).toHaveBeenCalledTimes(2)
  })
})

describe("useCapySession error copy", () => {
  function setup() {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "sk-x", model: "gpt-6-sol" },
      },
    })
    const onDataChanged = vi.fn()
    const { result } = renderHook(() => useCapySession({ ...baseOpts, onDataChanged }))
    act(() => {
      result.current.sendMessage("hi")
    })
    return { result, onDataChanged, fake: createdSessions[0] }
  }

  it("words a rate limit with the provider's name", () => {
    const { result, fake } = setup()
    act(() => {
      fake.emit({ type: "error", code: "rateLimited", status: 429, provider: "openai", message: "Rate limit reached" })
    })
    expect(result.current.messages.at(-1)?.blocks.at(-1)).toMatchObject({
      type: "error",
      message: "OpenAI API is rate-limiting requests right now. Try again in a moment.",
    })
  })

  it("routes a rejected send through the SDK error extractor", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "sk-x", model: "gpt-6-sol" },
      },
    })
    createSessionMock.mockImplementationOnce((opts) => {
      const err = Object.assign(new Error('400 {"message":"raw"}'), {
        status: 400,
        error: { message: "Readable message" },
      })
      const session: CapySession = {
        isAlive: true,
        send: vi.fn(async () => {
          throw err
        }),
        stop: vi.fn(async () => {}),
        restart: vi.fn(async () => {}),
        kill: vi.fn(async () => {}),
      }
      createdSessions.push({
        session,
        killSpy: vi.fn(),
        sendSpy: vi.fn(),
        stopSpy: vi.fn(),
        emit: opts.onEvent,
        exit: () => opts.onExit?.(),
      })
      return session
    })
    const { result } = renderHook(() => useCapySession(baseOpts))
    await act(async () => {
      result.current.sendMessage("hi")
      await Promise.resolve()
    })
    expect(result.current.messages.at(-1)?.blocks.at(-1)).toMatchObject({
      type: "error",
      message: "Readable message",
      status: 400,
    })
  })

  it("marks the question unsent when the adapter rolled it back out of history", () => {
    const { result, fake } = setup()
    act(() => {
      fake.emit({ type: "error", status: 400, provider: "openai", message: "Invalid image", rolledBack: true })
    })
    expect(result.current.messages[0]).toMatchObject({ role: "user", unsent: true })
    expect(result.current.messages.at(-1)?.blocks.at(-1)).toMatchObject({ type: "error", message: "Invalid image" })
  })

  it("leaves the question delivered on an error that kept it in history", () => {
    const { result, fake } = setup()
    act(() => {
      fake.emit({ type: "error", status: 500, provider: "openai", message: "server error" })
    })
    expect(result.current.messages[0]).not.toHaveProperty("unsent")
  })

  it.each([
    ["rolled back", true, 2],
    ["kept in history", false, 1],
  ])("reads the budget snapshot again only when the first send was %s", (_, rolledBack, reads) => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "sk-x", model: "gpt-6-sol" },
      },
    })
    const getBudgetSnapshot = vi.fn(() => undefined)
    const { result } = renderHook(() => useCapySession({ ...baseOpts, getBudgetSnapshot }))
    act(() => {
      result.current.sendMessage("hi")
    })
    act(() => {
      createdSessions[0].emit({ type: "error", status: 400, provider: "openai", message: "Invalid image", rolledBack })
    })
    act(() => {
      result.current.sendMessage("again")
    })
    expect(getBudgetSnapshot).toHaveBeenCalledTimes(reads)
  })

  it("ends the turn on a crash and hands the budget snapshot to the respawned process", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    const getBudgetSnapshot = vi.fn(() => undefined)
    const { result } = renderHook(() => useCapySession({ ...baseOpts, getBudgetSnapshot }))
    act(() => {
      result.current.sendMessage("hi")
    })
    act(() => {
      createdSessions[0].exit()
    })
    expect(result.current.isStreaming).toBe(false)
    expect(result.current.messages.at(-1)?.blocks[0]).toMatchObject({ type: "text", content: expect.stringMatching(/ended unexpectedly/) })

    act(() => {
      result.current.sendMessage("again")
    })
    expect(createdSessions[0].sendSpy).toHaveBeenCalledTimes(2)
    expect(getBudgetSnapshot).toHaveBeenCalledTimes(2)
  })

  it("refreshes data when a mutation lands after New Chat killed its turn", () => {
    const { result, onDataChanged, fake } = setup()
    act(() => {
      fake.emit({ type: "content", blocks: [{ type: "tool-activity", tool: "create_transaction", status: "running" }] })
    })
    act(() => {
      result.current.newChat()
    })
    expect(fake.killSpy).toHaveBeenCalled()

    act(() => {
      fake.emit({ type: "tool-result", tool: "create_transaction", id: "call_a", ok: true })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(1)
  })
})

describe("useCapySession events from a replaced session", () => {
  it("only refresh data — they never touch the new chat, its acks, or the import flow", () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "openai",
        openai: { apiKey: "sk-x", model: "gpt-6-sol" },
      },
    })
    const onDataChanged = vi.fn()
    const onImportStarted = vi.fn()
    const { result } = renderHook(() => useCapySession({ ...baseOpts, onDataChanged, onImportStarted }))
    act(() => {
      result.current.sendMessage("first")
    })
    const old = createdSessions[0]
    act(() => {
      result.current.newChat()
    })
    act(() => {
      result.current.sendMessage("second")
    })
    const fresh = createdSessions[1]
    const before = result.current.messages

    act(() => {
      old.emit({ type: "content", blocks: [{ type: "text", content: "stale" }] })
      old.emit({ type: "tool-result", tool: "start_import", id: "call_i", ok: true })
      old.emit({ type: "tool-result", tool: "create_transaction", id: "call_a", ok: true })
      old.emit({ type: "error", message: "stale failure" })
    })
    expect(result.current.messages).toEqual(before)
    expect(result.current.isStreaming).toBe(true)
    expect(onImportStarted).not.toHaveBeenCalled()
    expect(onDataChanged).toHaveBeenCalledTimes(1)

    act(() => {
      fresh.emit({ type: "content", blocks: [{ type: "tool-activity", tool: "create_transaction", status: "running" }] })
      fresh.emit({ type: "done" })
    })
    expect(onDataChanged).toHaveBeenCalledTimes(2)
  })
})
