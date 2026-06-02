import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"

import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { HelpScreen } from "./help-screen"
import { HELP_SECTIONS } from "./help-guide-content"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderHelp() {
  const rootRoute = createRootRoute()
  // HelpScreen reads path/name from the /budget search context and routes back
  // to the budget, so mount it under a matching parent route — mirrors the
  // real route topology and the Settings test harness.
  const budgetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/budget",
    validateSearch: (search: Record<string, unknown>) => ({
      path: (search.path as string) ?? "",
      name: (search.name as string) ?? "Budget",
    }),
    component: () => <Outlet />,
  })
  const budgetIndexRoute = createRoute({
    getParentRoute: () => budgetRoute,
    path: "/",
    component: () => <div>Budget home</div>,
  })
  const helpRoute = createRoute({
    getParentRoute: () => budgetRoute,
    path: "/help",
    component: HelpScreen,
  })
  const routeTree = rootRoute.addChildren([
    budgetRoute.addChildren([budgetIndexRoute, helpRoute]),
  ])

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: ["/budget/help?path=/test&name=Test"],
    }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return { router }
}

describe("HelpScreen", () => {
  it("renders the guide and a sidebar entry per section", async () => {
    await renderHelp()

    expect(
      screen.getByRole("heading", { name: "Capy Budget — user guide" }),
    ).toBeInTheDocument()

    const sidebar = screen.getByRole("navigation", { name: "Help sections" })
    for (const section of HELP_SECTIONS) {
      expect(
        within(sidebar).getByRole("button", { name: section.title }),
      ).toBeInTheDocument()
    }
  })

  it("scrolls to a section when its sidebar item is clicked", async () => {
    const user = userEvent.setup()
    const scrollSpy = vi.fn()
    Element.prototype.scrollIntoView = scrollSpy

    await renderHelp()

    const sidebar = screen.getByRole("navigation", { name: "Help sections" })
    await user.click(within(sidebar).getByRole("button", { name: "Capy" }))

    expect(scrollSpy).toHaveBeenCalled()
    // The clicked item becomes active.
    expect(
      within(sidebar).getByRole("button", { name: "Capy" }),
    ).toHaveAttribute("aria-current", "true")
  })

  it("opens the live demo externally", async () => {
    const user = userEvent.setup()
    await renderHelp()

    await user.click(screen.getByRole("button", { name: /try the live demo/i }))
    expect(shellOpen).toHaveBeenCalledWith("https://demo.capybudget.app")
  })

  it("dismisses to the budget on ESC", async () => {
    const user = userEvent.setup()
    const { router } = await renderHelp()
    expect(router.state.location.pathname).toBe("/budget/help")

    await user.keyboard("{Escape}")

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/budget")
    })
  })
})
