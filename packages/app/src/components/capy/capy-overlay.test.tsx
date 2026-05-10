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
  it("shows the 'Set up your AI assistant' card when provider is off", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
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
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
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
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
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

  it("renders the close button with 'Hide panel' as its accessible name", async () => {
    // Locks the icon's accessible label so the underlying icon swap
    // (PanelRightClose) can't drift the name without a test change.
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    await mountOverlay()

    expect(screen.getByLabelText("Hide panel")).toBeInTheDocument()
  })
})

describe("CapyOverlay click-through behavior", () => {
  it("clicking the Claude Code chip sets provider and navigates to /settings", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
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
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
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
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
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
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
    })
    const { router } = await mountOverlay()

    await user.click(screen.getByRole("button", { name: /Open settings/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings")
    })
    // Provider must remain untouched.
    expect(useIntelligenceStore.getState().config.provider).toBe("off")
  })

  it("disables the Claude Code chip when the CLI is not detected", async () => {
    const user = userEvent.setup()
    detectMock.mockReset()
    detectMock.mockResolvedValue(false)
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "off" },
    })
    await mountOverlay()

    const chip = await screen.findByRole("button", { name: "Claude Code" })
    await waitFor(() => {
      expect(chip).toBeDisabled()
    })

    // userEvent respects `disabled` and does not fire the click.
    await user.click(chip)
    expect(useIntelligenceStore.getState().config.provider).toBe("off")
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

describe("CapyOverlay tool-progress grouping", () => {
  beforeEach(() => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
  })

  it("groups consecutive tool-activity blocks into a single card", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "tool-activity", tool: "list_transactions" },
          { type: "tool-activity", tool: "spending_summary" },
          { type: "tool-activity", tool: "list_categories" },
          { type: "text", content: "Done." },
        ],
      },
    ]
    await mountOverlay({ messages, isStreaming: false })

    // All three tool labels render
    expect(screen.getByText("Querying transactions")).toBeInTheDocument()
    expect(screen.getByText("Calculating spending")).toBeInTheDocument()
    expect(screen.getByText("Querying categories")).toBeInTheDocument()
  })

  it("shows a spinner on the trailing tool while streaming", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "tool-activity", tool: "list_transactions" },
          { type: "tool-activity", tool: "spending_summary" },
        ],
      },
    ]
    const { container } = await mountOverlay({ messages, isStreaming: true })

    // Exactly one spinner (the trailing in-progress tool); the earlier
    // row shows a checkmark instead.
    const spinners = container.querySelectorAll(".animate-spin")
    expect(spinners.length).toBe(1)
  })

  it("shows checkmarks on every row when streaming has finished", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "tool-activity", tool: "list_transactions" },
          { type: "tool-activity", tool: "spending_summary" },
          { type: "text", content: "Done." },
        ],
      },
    ]
    const { container } = await mountOverlay({ messages, isStreaming: false })

    expect(container.querySelectorAll(".animate-spin").length).toBe(0)
  })

  it("splits tool blocks into two cards when separated by a non-tool block", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "tool-activity", tool: "list_transactions" },
          { type: "text", content: "Here you go." },
          { type: "tool-activity", tool: "spending_summary" },
        ],
      },
    ]
    const { container } = await mountOverlay({ messages, isStreaming: false })

    // Each tool group is its own rounded card with bg-muted/40.
    // A non-tool block in between forces a split, so we expect at least
    // two distinct grouped cards (not one merged card with both labels).
    const labels = container.querySelectorAll("[class*='rounded-xl'][class*='bg-muted']")
    // Grouped cards live inside the bubbles; can be 2+ depending on
    // surrounding bubble layout. Both labels must be present.
    expect(screen.getByText("Querying transactions")).toBeInTheDocument()
    expect(screen.getByText("Calculating spending")).toBeInTheDocument()
    // Sanity: at least the two tool group cards exist.
    expect(labels.length).toBeGreaterThanOrEqual(2)
  })
})

describe("CapyOverlay 'Thinking…' placeholder gate", () => {
  beforeEach(() => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
  })

  it("shows the placeholder when the trailing assistant message is empty and streaming", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      { id: "a1", role: "assistant", blocks: [] },
    ]
    await mountOverlay({ messages, isStreaming: true })

    expect(screen.getByText(/Thinking/)).toBeInTheDocument()
  })

  it("hides the placeholder when the trailing assistant message is empty but not streaming", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      { id: "a1", role: "assistant", blocks: [] },
    ]
    await mountOverlay({ messages, isStreaming: false })

    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument()
  })

  it("hides the placeholder once the assistant message has at least one block, even while streaming", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [{ type: "text", content: "Working on it…" }],
      },
    ]
    await mountOverlay({ messages, isStreaming: true })

    expect(screen.queryByText(/Thinking/)).not.toBeInTheDocument()
  })
})

describe("CapyOverlay tool → text → tool while streaming", () => {
  beforeEach(() => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
  })

  it("splits into two tool cards; only the trailing card spins", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "tool-activity", tool: "list_transactions" },
          { type: "text", content: "I see…" },
          { type: "tool-activity", tool: "spending_summary" },
        ],
      },
    ]
    const { container } = await mountOverlay({ messages, isStreaming: true })

    // Both labels render.
    expect(screen.getByText("Querying transactions")).toBeInTheDocument()
    expect(screen.getByText("Calculating spending")).toBeInTheDocument()

    // Two grouped tool cards (text in between forces a split).
    const toolCards = container.querySelectorAll(
      "[class*='rounded-xl'][class*='bg-muted']",
    )
    expect(toolCards.length).toBeGreaterThanOrEqual(2)

    // Exactly one spinner — only the trailing tool group is in-progress.
    // The first card's row shows a checkmark.
    expect(container.querySelectorAll(".animate-spin").length).toBe(1)
  })
})

describe("CapyOverlay follow-up chips", () => {
  beforeEach(() => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
  })

  it("renders chips and clicking one calls onSend with the chip's prompt", async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "text", content: "Here's the summary." },
          {
            type: "followups",
            chips: [
              { label: "Compare to 2023", prompt: "How does that compare to 2023?" },
              { label: "Monthly breakdown", prompt: "Show me the monthly breakdown." },
            ],
          },
        ],
      },
    ]
    await mountOverlay({ messages, onSend })

    const chip = screen.getByRole("button", { name: "Compare to 2023" })
    await user.click(chip)

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith("How does that compare to 2023?")
  })

  it("does not render anything for an empty chips array", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "text", content: "Done." },
          { type: "followups", chips: [] },
        ],
      },
    ]
    await mountOverlay({ messages })

    // The text block still renders.
    expect(screen.getByText("Done.")).toBeInTheDocument()
    // No follow-up buttons should be present (the only buttons in the
    // message area are the chat header controls).
    expect(screen.queryByRole("button", { name: /Compare/i })).not.toBeInTheDocument()
  })

  it("disables chips while streaming so a click can't queue a duplicate send", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "text", content: "Here's the summary." },
          {
            type: "followups",
            chips: [{ label: "Compare to 2023", prompt: "How does that compare to 2023?" }],
          },
        ],
      },
    ]
    await mountOverlay({ messages, isStreaming: true })

    const chip = screen.getByRole("button", { name: "Compare to 2023" })
    expect(chip).toBeDisabled()
  })
})

describe("CapyOverlay inline markdown", () => {
  beforeEach(() => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
  })

  it("renders dollar amounts in the brand color and non-money in plain bold", async () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", blocks: [{ type: "text", content: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        blocks: [
          { type: "text", content: "You spent **$1,234** in **food**." },
        ],
      },
    ]
    const { container } = await mountOverlay({ messages })

    const strongs = container.querySelectorAll("strong")
    expect(strongs.length).toBe(2)
    expect(strongs[0].textContent).toBe("$1,234")
    expect(strongs[0].className).toContain("text-brand")
    expect(strongs[1].textContent).toBe("food")
    expect(strongs[1].className).not.toContain("text-brand")
  })
})
