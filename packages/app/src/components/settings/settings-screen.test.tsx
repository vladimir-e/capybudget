import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DEFAULT_INTELLIGENCE_CONFIG } from "@capybudget/intelligence"

// Suppress sonner toasts during tests (must be hoisted via vi.mock).
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

// Mock the Claude CLI detector at the module level — the global Tauri
// shell mock always returns exit code 0, so we need to control detection
// directly.
const { recheckMock } = vi.hoisted(() => ({
  recheckMock: vi.fn<() => Promise<boolean>>(),
}))

vi.mock("@/services/claude-cli-detect", () => ({
  detectClaudeCli: recheckMock,
  recheckClaudeCli: recheckMock,
  _resetClaudeCliCacheForTests: () => {},
}))

// The Updates section mounts in this (non-demo) env; keep its Tauri-only
// imports inert so the screen renders without a Tauri shell.
vi.mock("@/lib/updater", () => ({
  checkForUpdate: vi.fn().mockResolvedValue(null),
  installUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.0.0"),
}))

// The Currency section (under General) reads accounts to derive in-use foreign
// currencies; this screen test isn't about account data, so stub it empty —
// a USD-only budget with no foreign rows.
vi.mock("@/hooks/use-budget-data", () => ({
  useAccounts: () => ({ data: [] }),
}))

import { SettingsScreen } from "./settings-screen"
import {
  useIntelligenceStore,
  _resetIntelligenceStoreForTests,
  _setStoreLoaderForTests,
  _resetStoreForTests,
} from "@/stores/intelligence-store"

// ── Test rendering helper ───────────────────────────────

async function renderSettings(
  // Most cases exercise the Intelligence (AI provider) section; deep-link to
  // it so they don't depend on which section is the default landing.
  initialPath: string = "/budget/settings?path=/test&name=Test&section=intelligence",
) {
  const rootRoute = createRootRoute()
  // Settings reads path/name from the /budget search context and routes back to
  // the budget, so mount it under a matching parent route.
  const budgetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/budget",
    validateSearch: (search: Record<string, unknown>) => ({
      path: (search.path as string) ?? "",
      name: (search.name as string) ?? "Budget",
    }),
    component: () => <Outlet />,
  })
  const settingsRoute = createRoute({
    getParentRoute: () => budgetRoute,
    path: "/settings",
    component: SettingsScreen,
  })
  const routeTree = rootRoute.addChildren([
    budgetRoute.addChildren([settingsRoute]),
  ])

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  await router.load()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...result, router }
}

// ── Setup ───────────────────────────────────────────────

beforeEach(() => {
  _resetStoreForTests()
  _resetIntelligenceStoreForTests()
  recheckMock.mockReset()
  recheckMock.mockResolvedValue(true)
  // Default backend: explicit null — Phase 10.5b first-run default.
  _setStoreLoaderForTests(async () => ({
    get: async () => ({ ...DEFAULT_INTELLIGENCE_CONFIG, provider: null }),
    set: async () => {},
  }))
})

afterEach(() => {
  cleanup()
})

// ── Tests ───────────────────────────────────────────────

describe("SettingsScreen", () => {
  it("renders the AI Provider card with all four options", async () => {
    await renderSettings()

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByText("AI Provider")).toBeInTheDocument()
    expect(screen.getByText("Off")).toBeInTheDocument()
    expect(screen.getByText("Claude Code")).toBeInTheDocument()
    expect(screen.getByText("Anthropic API")).toBeInTheDocument()
    expect(screen.getByText("OpenAI API")).toBeInTheDocument()
  })

  it("orders providers Off / Anthropic / OpenAI / Claude Code", async () => {
    await renderSettings()

    const labels = screen
      .getAllByText(/^(Off|Anthropic API|OpenAI API|Claude Code)$/)
      .map((el) => el.textContent)
    expect(labels).toEqual([
      "Off",
      "Anthropic API",
      "OpenAI API",
      "Claude Code",
    ])
  })

  it("badges Claude Code as advanced", async () => {
    await renderSettings()
    expect(screen.getByText("advanced")).toBeInTheDocument()
  })

  it("exposes a model selector for Claude Code", async () => {
    recheckMock.mockResolvedValue(true)
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    await renderSettings()

    // The shared ModelField renders a Model label + custom-model toggle.
    expect(await screen.findByLabelText("Model")).toBeInTheDocument()
    expect(screen.getByLabelText("Use a custom model")).toBeInTheDocument()
  })

  it("Claude Code custom-model field accepts a full model ID", async () => {
    const user = userEvent.setup()
    recheckMock.mockResolvedValue(true)
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    await renderSettings()

    await user.click(await screen.findByLabelText("Use a custom model"))
    const input = screen.getByPlaceholderText("model-identifier")
    await user.type(input, "claude-opus-4-8")

    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.claudeCli.model).toBe(
        "claude-opus-4-8",
      )
    })
  })

  it("renders the chat-instructions editor in the Intelligence section", async () => {
    await renderSettings()
    expect(screen.getByText("Chat instructions")).toBeInTheDocument()
  })

  it("'Off' is the selected radio for first-run users", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG },
    })
    await renderSettings()

    // The Off label is the first option and matches the default config.
    expect(
      screen.getByText(
        "Capy is disabled. Pick a provider below to enable AI features.",
      ),
    ).toBeInTheDocument()
  })

  it("hides per-provider configuration when provider is null", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: null },
    })
    await renderSettings()

    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument()
  })

  it("disables the Claude Code option when CLI is not detected", async () => {
    recheckMock.mockResolvedValue(false)
    await renderSettings()

    await waitFor(() => {
      expect(screen.getByText(/Not detected/i)).toBeInTheDocument()
    })
    expect(screen.getByText("claude.ai/code")).toBeInTheDocument()
  })

  it("toggling provider updates the store", async () => {
    const user = userEvent.setup()
    await renderSettings()

    // Wait for the probe to settle so radios are interactive.
    await waitFor(() => {
      expect(recheckMock).toHaveBeenCalled()
    })

    const anthropicLabel = screen.getByText("Anthropic API").closest("label")
    expect(anthropicLabel).not.toBeNull()
    await user.click(anthropicLabel!)

    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.provider).toBe("anthropic")
    })
  })

  it("saves the API key on blur, not per keystroke", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "anthropic" },
    })
    await renderSettings()

    const keyInput = await screen.findByLabelText("API key")
    await user.type(keyInput, "sk-ant-test-1234")
    expect(useIntelligenceStore.getState().config.anthropic.apiKey).toBe("")

    await user.tab()
    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.anthropic.apiKey).toBe(
        "sk-ant-test-1234",
      )
    })
  })

  it("shows the last 4 chars of the saved key for confirmation", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-ant-secret-ab12", model: "claude-sonnet-4-6" },
      },
    })
    await renderSettings()

    expect(await screen.findByText(/ab12/)).toBeInTheDocument()
  })

  it("custom model toggle replaces the select with a text input", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "openai" },
    })
    await renderSettings()

    const customCheckbox = await screen.findByLabelText("Use a custom model")
    await user.click(customCheckbox)

    const customInput = screen.getByPlaceholderText("model-identifier")
    // Custom input pre-populates with the current model value — clear first.
    await user.clear(customInput)
    await user.type(customInput, "gpt-5-pro-custom")

    await waitFor(() => {
      expect(useIntelligenceStore.getState().config.openai.model).toBe(
        "gpt-5-pro-custom",
      )
    })
  })

  it("test connection button is disabled when API key is empty", async () => {
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "anthropic" },
    })
    await renderSettings()

    const testButton = await screen.findByRole("button", {
      name: /test connection/i,
    })
    expect(testButton).toBeDisabled()
  })

  it("warns when claude-cli is selected but not detected", async () => {
    recheckMock.mockResolvedValue(false)
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "claude-cli" },
    })
    await renderSettings()

    await waitFor(() => {
      expect(
        screen.getByText("Claude Code is no longer detected"),
      ).toBeInTheDocument()
    })
  })

  it("eye toggle reveals and hides the API key", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: {
        ...DEFAULT_INTELLIGENCE_CONFIG,
        provider: "anthropic",
        anthropic: { apiKey: "sk-ant-existing", model: "claude-sonnet-4-6" },
      },
    })
    await renderSettings()

    const keyInput = (await screen.findByLabelText("API key")) as HTMLInputElement
    expect(keyInput.type).toBe("password")

    await user.click(screen.getByLabelText("Show API key"))
    expect(keyInput.type).toBe("text")

    await user.click(screen.getByLabelText("Hide API key"))
    expect(keyInput.type).toBe("password")
  })

  it("returns to the budget on Escape", async () => {
    const user = userEvent.setup()
    const { router } = await renderSettings()
    expect(router.state.location.pathname).toBe("/budget/settings")

    await user.keyboard("{Escape}")

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/budget")
    })
  })

  it("ignores Escape while a field is focused", async () => {
    const user = userEvent.setup()
    useIntelligenceStore.setState({
      hydrated: true,
      config: { ...DEFAULT_INTELLIGENCE_CONFIG, provider: "anthropic" },
    })
    const { router } = await renderSettings()

    const keyInput = await screen.findByLabelText("API key")
    keyInput.focus()
    await user.keyboard("{Escape}")

    // The field keeps its own Esc; settings stays mounted, no navigation.
    expect(router.state.location.pathname).toBe("/budget/settings")
    expect(
      screen.getByRole("button", { name: "Back to budget" }),
    ).toBeInTheDocument()
  })

  it("defaults to the General section when no section is deep-linked", async () => {
    await renderSettings("/budget/settings?path=/test&name=Test")
    expect(await screen.findByText("Budget-wide basics.")).toBeInTheDocument()
    expect(screen.getByText("How amounts are displayed.")).toBeInTheDocument()
  })

  it("switches to Updates when the section param changes after mount", async () => {
    const { router } = await renderSettings()

    // Mounted on Intelligence (deep-linked), not the Updates section.
    expect(screen.getByText("AI Provider")).toBeInTheDocument()
    expect(screen.queryByText("Keep Capy up to date.")).not.toBeInTheDocument()

    await router.navigate({
      to: "/budget/settings",
      search: { path: "/test", name: "Test", section: "updates" },
    })

    await waitFor(() => {
      expect(screen.getByText("Keep Capy up to date.")).toBeInTheDocument()
    })
  })

  it("lets a sidebar click switch sections without a URL change", async () => {
    const user = userEvent.setup()
    // No section param — the click must drive local state only.
    const { router } = await renderSettings("/budget/settings?path=/test&name=Test")

    await user.click(screen.getByRole("button", { name: /Updates/i }))

    expect(await screen.findByText("Keep Capy up to date.")).toBeInTheDocument()
    // The click drives local state only — the deep-link param stays unset.
    expect(router.state.location.search).not.toHaveProperty("section")
  })
})
