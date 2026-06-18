import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import type { BudgetMeta } from "@capybudget/core"
import { GeneralSection } from "./general-section"

const setName = vi.fn()
const setCurrency = vi.fn()
const setBudgetFormat = vi.fn()

let meta: BudgetMeta

vi.mock("@/hooks/use-budget-meta", () => ({
  useBudgetMeta: () => ({
    data: meta,
    isLoading: false,
    setName,
    setCurrency,
    setBudgetFormat,
    save: vi.fn(),
  }),
}))

function metaWith(over: Partial<BudgetMeta> = {}): BudgetMeta {
  return {
    schemaVersion: 3,
    name: "My Budget",
    currency: "USD",
    currencyDecimals: 2,
    currencySymbolPosition: "before",
    createdAt: "",
    lastModified: "",
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  meta = metaWith()
})

afterEach(cleanup)

describe("GeneralSection", () => {
  it("commits a rename on blur, not per keystroke", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    const input = screen.getByLabelText("Name")
    await user.clear(input)
    await user.type(input, "Travel")
    expect(setName).not.toHaveBeenCalled()

    await user.tab()
    expect(setName).toHaveBeenCalledWith("Travel")
  })

  it("does not write when the name is unchanged or blank", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    const input = screen.getByLabelText("Name")
    await user.click(input)
    await user.tab()
    expect(setName).not.toHaveBeenCalled()

    await user.clear(input)
    await user.tab()
    expect(setName).not.toHaveBeenCalled()
  })

  it("wires the precision select to setBudgetFormat, preserving symbol position", async () => {
    const user = userEvent.setup()
    meta = metaWith({ currencySymbolPosition: "after" })
    render(<GeneralSection budgetPath="/b" />)

    await user.click(screen.getByLabelText("Decimals"))
    await user.click(screen.getByRole("option", { name: "0" }))

    expect(setBudgetFormat).toHaveBeenCalledWith({ decimals: 0, symbolPosition: "after" })
  })

  it("wires the symbol toggle to setBudgetFormat, preserving decimals", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    await user.click(screen.getByRole("button", { name: "After" }))

    expect(setBudgetFormat).toHaveBeenCalledWith({ decimals: 2, symbolPosition: "after" })
  })

  it("disables the symbol toggle for a symbol-less currency with a hint", () => {
    meta = metaWith({ currency: "CHF" })
    render(<GeneralSection budgetPath="/b" />)

    expect(screen.getByRole("button", { name: "Before" })).toBeDisabled()
    expect(screen.getByText(/no symbol/i)).toBeInTheDocument()
  })

  it("renders a live preview reflecting the current format", () => {
    meta = metaWith({ currency: "USD", currencyDecimals: 2, currencySymbolPosition: "before" })
    render(<GeneralSection budgetPath="/b" />)

    // The preview reads from the CurrencyContext (USD default outside a provider),
    // so it shows the default-currency formatting of the sample amount.
    expect(screen.getByText(/Preview:/)).toBeInTheDocument()
    expect(screen.getByText("$1,234,567.89")).toBeInTheDocument()
  })

  it("points the request-currency link at the plain repo page", async () => {
    const user = userEvent.setup()
    render(<GeneralSection budgetPath="/b" />)

    await user.click(screen.getByRole("button", { name: /Request currency/i }))
    expect(shellOpen).toHaveBeenCalledWith("https://github.com/vladimir-e/capybudget")
  })
})
