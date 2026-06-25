import { describe, it, expect, vi, beforeEach } from "vitest"
import { useAppStore } from "@/stores/app-store"
import { resolveLaunchRedirect, resetLaunchResolution } from "./-launch-budget"

// The resolver imports its budget service via a deep relative path; mock at
// the same path so vi.mock can resolve it.
const mockDetectBudget = vi.fn()
vi.mock("../../../../src/services/budget", () => ({
  detectBudget: (...args: unknown[]) => mockDetectBudget(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  resetLaunchResolution()
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

  it("falls through when no launch budget is set", async () => {
    expect(await resolveLaunchRedirect()).toBeNull()
    expect(mockDetectBudget).not.toHaveBeenCalled()
  })

  it("falls through without clearing the pointer when validation fails", async () => {
    useAppStore.setState({ launchBudgetPath: "/gone" })
    mockDetectBudget.mockRejectedValue(new Error("unmounted"))

    expect(await resolveLaunchRedirect()).toBeNull()
    // Pointer survives so the next launch retries (drive may be back).
    expect(useAppStore.getState().launchBudgetPath).toBe("/gone")
  })

  it("falls through when the folder is no longer a budget, keeping the pointer", async () => {
    useAppStore.setState({ launchBudgetPath: "/notabudget" })
    mockDetectBudget.mockResolvedValue(null)

    expect(await resolveLaunchRedirect()).toBeNull()
    expect(useAppStore.getState().launchBudgetPath).toBe("/notabudget")
  })
})
