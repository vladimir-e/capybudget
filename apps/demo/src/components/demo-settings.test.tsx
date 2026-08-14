import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ProviderSection } from "@/components/settings/provider-section"
import { SettingsScreen } from "@/components/settings/settings-screen"

// Runs under the demo vite config, so __IS_DEMO__ is true here.

// The Currency section (under General) reads accounts to derive in-use foreign
// currencies; this screen test isn't about account data, so stub it empty —
// a USD-only budget with no foreign rows.
vi.mock("@/hooks/use-budget-data", () => ({
  useAccounts: () => ({ data: [] }),
}))

// The Currency section's switch path uses the rebase hook, which reaches for the
// repository; this screen test has no RepositoryProvider, so stub it inert.
vi.mock("@/hooks/use-rebase-currency", () => ({
  useRebaseCurrency: () => vi.fn(),
}))

afterEach(cleanup)

async function renderSettings() {
  const rootRoute = createRootRoute()
  const budgetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/budget",
    validateSearch: (search: Record<string, unknown>) => ({
      path: (search.path as string) ?? "",
      name: (search.name as string) ?? "Budget",
      section: search.section as string | undefined,
    }),
    component: () => <Outlet />,
  })
  const settingsRoute = createRoute({
    getParentRoute: () => budgetRoute,
    path: "/settings",
    component: SettingsScreen,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([budgetRoute.addChildren([settingsRoute])]),
    history: createMemoryHistory({
      initialEntries: ["/budget/settings?path=/test&name=Test"],
    }),
  })
  await router.load()
  // SettingsScreen → GeneralSection → useBudgetMeta reads via TanStack Query,
  // so the screen needs a QueryClient just like the app-side settings test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe("ProviderSection in the demo", () => {
  it("shows the desktop-only notice", () => {
    render(<ProviderSection />)
    expect(screen.getByTestId("provider-demo-notice")).toBeInTheDocument()
  })

  it("disables every provider radio", () => {
    render(<ProviderSection />)
    const radios = screen.getAllByRole("radio")
    // Off / Anthropic / OpenAI / Ollama / Claude Code.
    expect(radios.length).toBe(5)
    // base-ui marks a disabled radio with data-disabled rather than the
    // native disabled attribute.
    for (const radio of radios) {
      expect(radio).toHaveAttribute("data-disabled")
    }
  })

  it("does not render any per-provider config (no API key field)", () => {
    render(<ProviderSection />)
    expect(screen.queryByText("API key")).not.toBeInTheDocument()
  })
})

describe("SettingsScreen in the demo", () => {
  it("omits the Updates nav item — updates are desktop-only", async () => {
    await renderSettings()
    expect(
      screen.queryByRole("button", { name: /updates/i }),
    ).not.toBeInTheDocument()
  })

  it("omits the open-on-launch toggle — auto-launch is desktop-only", async () => {
    await renderSettings()
    expect(screen.queryByLabelText(/open this budget on launch/i)).not.toBeInTheDocument()
  })
})
