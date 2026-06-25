import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { BudgetMeta } from "@capybudget/core"
import { useAppStore } from "@/stores/app-store"
import { GeneralSection } from "./general-section"

const setName = vi.fn()

let meta: BudgetMeta

vi.mock("@/hooks/use-budget-meta", () => ({
  useBudgetMeta: () => ({
    data: meta,
    isLoading: false,
    setName,
    save: vi.fn(),
  }),
}))

function metaWith(over: Partial<BudgetMeta> = {}): BudgetMeta {
  return {
    schemaVersion: 4,
    name: "My Budget",
    defaultCurrency: "USD",
    currencies: { USD: { decimals: 2, symbolPosition: "before" } },
    createdAt: "",
    lastModified: "",
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  meta = metaWith()
  useAppStore.setState({ launchBudgetPath: null })
})

afterEach(cleanup)

describe("GeneralSection", () => {
  it("commits a rename on blur, not per keystroke", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    const input = screen.getByLabelText("Budget name")
    await user.clear(input)
    await user.type(input, "Travel")
    expect(setName).not.toHaveBeenCalled()

    await user.tab()
    expect(setName).toHaveBeenCalledWith("Travel")
  })

  it("does not write when the name is unchanged or blank", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    const input = screen.getByLabelText("Budget name")
    await user.click(input)
    await user.tab()
    expect(setName).not.toHaveBeenCalled()

    await user.clear(input)
    await user.tab()
    expect(setName).not.toHaveBeenCalled()
  })

  it("reflects and toggles this budget as the launch budget", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    const toggle = screen.getByLabelText("Open this budget on launch")
    expect(toggle).not.toBeChecked()

    await user.click(toggle)
    expect(useAppStore.getState().launchBudgetPath).toBe("/b")
    expect(toggle).toBeChecked()

    await user.click(toggle)
    expect(useAppStore.getState().launchBudgetPath).toBeNull()
  })

  it("shows unchecked when a different budget is the launch budget", () => {
    useAppStore.setState({ launchBudgetPath: "/other" })
    render(<GeneralSection budgetPath="/b" />)
    expect(screen.getByLabelText("Open this budget on launch")).not.toBeChecked()
  })
})
