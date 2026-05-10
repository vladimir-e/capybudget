import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { CapyOverlay } from "./capy-overlay"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  _resetStoreForTests,
} from "@/stores/intelligence-store"
import { DEFAULT_INTELLIGENCE_CONFIG, type ChatMessage } from "@capybudget/intelligence"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

// Module-level mock for the Claude CLI detector. Default: detected (true).
// Individual tests override with detectMock.mockResolvedValueOnce(false).
const { detectMock } = vi.hoisted(() => ({
  detectMock: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@/services/claude-cli-detect", () => ({
  detectClaudeCli: detectMock,
  recheckClaudeCli: detectMock,
  _resetClaudeCliCacheForTests: () => {},
}))

interface MountOptions {
  open?: boolean
  messages?: ChatMessage[]
  isStreaming?: boolean
  onSend?: (text: string, files?: unknown) => void
  onStop?: () => void
  onNewChat?: () => void
}

async function mountOverlay({
  open = true,
  messages = [],
  isStreaming = false,
  onSend = () => {},
  onStop = () => {},
  onNewChat = () => {},
}: MountOptions = {}) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <CapyOverlay
        open={open}
        onClose={() => {}}
        messages={messages}
        isStreaming={isStreaming}
        onSend={onSend}
        onStop={onStop}
        onNewChat={onNewChat}
        instructions=""
        onSaveInstructions={async () => {}}
        commands={[]}
        onSaveCommands={async () => {}}
      />
    ),
  })
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => <div>Settings</div>,
  })

  const routeTree = rootRoute.addChildren([indexRoute, settingsRoute])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  })

  await router.load()
  return { ...render(<RouterProvider router={router} />), router }
}

beforeEach(() => {
  _resetStoreForTests()
  _resetIntelligenceStoreForTests()
  _setStoreLoaderForTests(async () => ({
    get: async () => null,
    set: async () => {},
  }))
  detectMock.mockReset()
  detectMock.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
})

describe("CapyOverlay empty state", () => {
  it("shows the 'Set up your AI assistant' card when provider is null", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    await mountOverlay()

    expect(screen.getByText("Set up your AI assistant")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Open settings/i }),
    ).toBeInTheDocument()
  })

  it("offers a quick-pick chip for each provider", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    await mountOverlay()

    expect(screen.getByRole("button", { name: "Claude Code" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Anthropic" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "OpenAI" })).toBeInTheDocument()
  })

  it("shows the empty state when an API provider has no API key", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "", model: "claude-sonnet-4-6" },
      },
    })
    await mountOverlay()

    expect(screen.getByText("Set up your AI assistant")).toBeInTheDocument()
  })

  it("hides the chat input entirely when not configured", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    await mountOverlay()

    expect(
      screen.queryByPlaceholderText(/Ask Capy anything/i),
    ).not.toBeInTheDocument()
    // The footer hints and command/instructions buttons should also be absent.
    expect(screen.queryByText(/Shift \+ Enter/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Custom instructions/i }),
    ).not.toBeInTheDocument()
  })

  it("shows the welcome state and enables input when configured", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    await mountOverlay()

    expect(screen.getByText(/Hey, I.m Capy\./)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "How am I doing this month?" }),
    ).toBeInTheDocument()
    const textarea = screen.getByPlaceholderText(
      "Ask Capy anything about your finances...",
    )
    expect(textarea).not.toBeDisabled()
  })

  it("treats anthropic with a non-empty key as configured", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-ant-x", model: "claude-sonnet-4-6" },
      },
    })
    await mountOverlay()

    expect(screen.getByText(/Hey, I.m Capy\./)).toBeInTheDocument()
  })
})

describe("CapyOverlay click-through behavior", () => {
  it("clicking the Claude Code chip sets provider and navigates to /settings", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    const { router } = await mountOverlay()

    // Wait for CLI detection so the chip is enabled.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Claude Code" }),
      ).not.toBeDisabled()
    })

    await user.click(screen.getByRole("button", { name: "Claude Code" }))

    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.provider).toBe("claude-cli")
      expect(router.state.location.pathname).toBe("/settings")
    })
  })

  it("clicking the Anthropic chip sets provider and navigates to /settings", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    const { router } = await mountOverlay()

    await user.click(screen.getByRole("button", { name: "Anthropic" }))

    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.provider).toBe("anthropic")
      expect(router.state.location.pathname).toBe("/settings")
    })
  })

  it("clicking the OpenAI chip sets provider and navigates to /settings", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    const { router } = await mountOverlay()

    await user.click(screen.getByRole("button", { name: "OpenAI" }))

    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.provider).toBe("openai")
      expect(router.state.location.pathname).toBe("/settings")
    })
  })

  it("clicking 'Open settings' navigates without setting a provider", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    const { router } = await mountOverlay()

    await user.click(screen.getByRole("button", { name: /Open settings/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings")
    })
    // Provider must remain untouched.
    expect(useIntelligenceStore.getState().config.provider).toBeNull()
  })

  it("disables the Claude Code chip when the CLI is not detected", async () => {
    const user = userEvent.setup()
    detectMock.mockReset()
    detectMock.mockResolvedValue(false)
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    await mountOverlay()

    const chip = await screen.findByRole("button", { name: "Claude Code" })
    await waitFor(() => {
      expect(chip).toBeDisabled()
    })

    // userEvent respects `disabled` and does not fire the click.
    await user.click(chip)
    expect(useIntelligenceStore.getState().config.provider).toBeNull()
  })

  it("clicking a suggestion card sends the prompt", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    await mountOverlay({ onSend })

    await user.click(
      screen.getByRole("button", { name: "How am I doing this month?" }),
    )

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith("How am I doing this month?")
  })

  it("clicking 'New chat' calls onNewChat when messages exist", async () => {
    const user = userEvent.setup()
    const onNewChat = vi.fn()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", blocks: [{ type: "text", content: "hi" }] },
    ]
    await mountOverlay({ messages, onNewChat })

    await user.click(screen.getByRole("button", { name: /New chat/i }))
    expect(onNewChat).toHaveBeenCalledTimes(1)
  })
})
