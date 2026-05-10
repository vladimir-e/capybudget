import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
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
import { DEFAULT_INTELLIGENCE_CONFIG } from "@capybudget/intelligence"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

interface MountOptions {
  open?: boolean
}

async function mountOverlay({ open = true }: MountOptions = {}) {
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <CapyOverlay
        open={open}
        onClose={() => {}}
        messages={[]}
        isStreaming={false}
        onSend={() => {}}
        onStop={() => {}}
        onNewChat={() => {}}
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
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  _resetStoreForTests()
  _resetIntelligenceStoreForTests()
  _setStoreLoaderForTests(async () => ({
    get: async () => null,
    set: async () => {},
  }))
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

  it("disables the chat input when not configured", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    await mountOverlay()

    const textarea = screen.getByPlaceholderText(
      "Set up Capy in settings to enable chat",
    )
    expect(textarea).toBeDisabled()
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
