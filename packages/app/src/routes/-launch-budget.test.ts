import { describe, it, expect, vi, beforeEach } from "vitest"
import { useAppStore } from "@/stores/app-store"
import { resolveLaunchRedirect, resetLaunchResolution } from "./-launch-budget"
import { markSkipLaunchRedirect, consumeSkipLaunchRedirect } from "@/lib/crash-recovery"
import { consumeReopenFailure } from "@/lib/reopen-failure"

// The resolver imports its budget service via a deep relative path; mock at
// the same path so vi.mock can resolve it.
const mockDetectBudget = vi.fn()
vi.mock("../../../../src/services/budget", () => ({
  detectBudget: (...args: unknown[]) => mockDetectBudget(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  resetLaunchResolution()
  sessionStorage.clear()
  consumeReopenFailure()
  useAppStore.setState({ recentBudgets: [], launchBudgetPath: null })
})

describe("resolveLaunchRedirect", () => {
  it("redirects to the launch budget and records it in recents", async () => {
    useAppStore.setState({ launchBudgetPath: "/b" })
    mockDetectBudget.mockResolvedValue({ name: "Renamed" })

    const redirect = await resolveLaunchRedirect()

    expect(redirect?.options).toMatchObject({
      to: "/budget",
      search: { path: "/b", name: "Renamed" },
    })
    const recents = useAppStore.getState().recentBudgets
    expect(recents).toHaveLength(1)
    expect(recents[0]).toMatchObject({ path: "/b", name: "Renamed" })
  })

  it("fires at most once per process — a second call falls through to the selector", async () => {
    useAppStore.setState({ launchBudgetPath: "/b" })
    mockDetectBudget.mockResolvedValue({ name: "Budget" })

    expect(await resolveLaunchRedirect()).not.toBeNull()
    expect(await resolveLaunchRedirect()).toBeNull()
    expect(mockDetectBudget).toHaveBeenCalledTimes(1)
  })

  it("claims the launch before validation so concurrent calls can't double-fire", async () => {
    useAppStore.setState({ launchBudgetPath: "/b" })
    mockDetectBudget.mockResolvedValue({ name: "Budget" })

    const [first, second] = await Promise.all([
      resolveLaunchRedirect(),
      resolveLaunchRedirect(),
    ])

    const fired = [first, second].filter((r) => r !== null)
    expect(fired).toHaveLength(1)
    expect(mockDetectBudget).toHaveBeenCalledTimes(1)
  })

  it("skips the redirect once when the error screen flagged a restart", async () => {
    useAppStore.setState({ launchBudgetPath: "/b" })
    markSkipLaunchRedirect()

    expect(await resolveLaunchRedirect()).toBeNull()
    // One-shot: already consumed, so nothing is left to skip on the next launch.
    expect(consumeSkipLaunchRedirect()).toBe(false)
    expect(mockDetectBudget).not.toHaveBeenCalled()
  })

  it("falls through when no launch budget is set", async () => {
    expect(await resolveLaunchRedirect()).toBeNull()
    expect(mockDetectBudget).not.toHaveBeenCalled()
  })

  it("clears the pointer when validation throws so the failure surfaces once", async () => {
    useAppStore.setState({ launchBudgetPath: "/gone" })
    mockDetectBudget.mockRejectedValue(new Error("unmounted"))

    expect(await resolveLaunchRedirect()).toBeNull()
    // Auto-open is off now; the next launch lands on the selector, not a retry.
    expect(useAppStore.getState().launchBudgetPath).toBeNull()
  })

  it("clears the pointer when the folder is no longer a budget", async () => {
    useAppStore.setState({ launchBudgetPath: "/notabudget" })
    mockDetectBudget.mockResolvedValue(null)

    expect(await resolveLaunchRedirect()).toBeNull()
    expect(useAppStore.getState().launchBudgetPath).toBeNull()
  })

  it("flags a reopen failure with the recent's name when validation throws", async () => {
    useAppStore.setState({
      launchBudgetPath: "/gone",
      recentBudgets: [{ path: "/gone", name: "Household", lastOpened: "2026-01-01" }],
    })
    mockDetectBudget.mockRejectedValue(new Error("no access"))

    await resolveLaunchRedirect()

    expect(consumeReopenFailure()).toEqual({ path: "/gone", name: "Household" })
  })

  it("flags a reopen failure (falling back to the folder's basename) when the folder isn't a budget", async () => {
    useAppStore.setState({ launchBudgetPath: "/some/path/Groceries" })
    mockDetectBudget.mockResolvedValue(null)

    await resolveLaunchRedirect()

    expect(consumeReopenFailure()).toEqual({ path: "/some/path/Groceries", name: "Groceries" })
  })

  it("does not flag a reopen failure on a successful reopen", async () => {
    useAppStore.setState({ launchBudgetPath: "/b" })
    mockDetectBudget.mockResolvedValue({ name: "Budget" })

    await resolveLaunchRedirect()

    expect(consumeReopenFailure()).toBeNull()
  })
})
