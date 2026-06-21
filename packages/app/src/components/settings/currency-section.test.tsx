import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import type { BudgetMeta, CurrencySettings } from "@capybudget/core"
import { CurrencySection } from "./currency-section"

const setCurrency = vi.fn()
const setBudgetFormat = vi.fn()

let meta: BudgetMeta

vi.mock("@/hooks/use-budget-meta", () => ({
  useBudgetMeta: () => ({
    data: meta,
    isLoading: false,
    setCurrency,
    setBudgetFormat,
    save: vi.fn(),
  }),
}))

// A single-currency budget whose default entry carries the given display
// settings — the only entry the section reads.
function metaWith(
  currency = "USD",
  settings: CurrencySettings = { decimals: 2, symbolPosition: "before" },
): BudgetMeta {
  return {
    schemaVersion: 4,
    name: "My Budget",
    defaultCurrency: currency,
    currencies: { [currency]: settings },
    createdAt: "",
    lastModified: "",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  meta = metaWith()
})

afterEach(cleanup)

const openFormatSettings = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /Format settings/i }))

describe("CurrencySection", () => {
  it("keeps the format controls collapsed by default", () => {
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.getByText("Preview")).toBeInTheDocument()
    expect(screen.queryByLabelText("Decimals")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Before" })).not.toBeInTheDocument()
  })

  it("renders a live preview with a positive and a negative sample", () => {
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" })
    render(<CurrencySection budgetPath="/b" />)

    // The preview reads from the CurrencyContext (USD default outside a provider),
    // so it shows the default-currency formatting of the income/expense samples.
    const income = screen.getByText("$4,215.50")
    const expense = screen.getByText("-$1,289.00")
    expect(income).toHaveClass("text-amount-income")
    expect(expense).toHaveClass("text-amount-expense")
  })

  it("wires the precision select to setBudgetFormat, preserving symbol position", async () => {
    const user = userEvent.setup()
    meta = metaWith("USD", { decimals: 2, symbolPosition: "after" })
    render(<CurrencySection budgetPath="/b" />)

    await openFormatSettings(user)
    await user.click(screen.getByLabelText("Decimals"))
    await user.click(await screen.findByRole("option", { name: "0" }))

    expect(setBudgetFormat).toHaveBeenCalledWith({ decimals: 0, symbolPosition: "after" })
  })

  it("wires the symbol toggle to setBudgetFormat, preserving decimals", async () => {
    const user = userEvent.setup()
    render(<CurrencySection budgetPath="/b" />)

    await openFormatSettings(user)
    await user.click(screen.getByRole("button", { name: "After" }))

    expect(setBudgetFormat).toHaveBeenCalledWith({ decimals: 2, symbolPosition: "after" })
  })

  it("disables the symbol toggle for a symbol-less currency with a hint", async () => {
    const user = userEvent.setup()
    meta = metaWith("CHF")
    render(<CurrencySection budgetPath="/b" />)

    await openFormatSettings(user)
    expect(screen.getByRole("button", { name: "Before" })).toBeDisabled()
    expect(screen.getByText(/no symbol/i)).toBeInTheDocument()
  })

  it("hides the reset link when the format already matches the currency's defaults", async () => {
    // USD defaults are 2 decimals, symbol before — the metaWith baseline.
    const user = userEvent.setup()
    render(<CurrencySection budgetPath="/b" />)

    await openFormatSettings(user)
    expect(screen.queryByRole("button", { name: /Reset to/i })).not.toBeInTheDocument()
  })

  it("resets to the currency's defaults when the format diverges", async () => {
    const user = userEvent.setup()
    meta = metaWith("USD", { decimals: 0, symbolPosition: "off" })
    render(<CurrencySection budgetPath="/b" />)

    await openFormatSettings(user)
    await user.click(screen.getByRole("button", { name: /Reset to USD defaults/i }))

    expect(setBudgetFormat).toHaveBeenCalledWith({ decimals: 2, symbolPosition: "before" })
  })

  it("points the request-currency link at the plain repo page", async () => {
    const user = userEvent.setup()
    render(<CurrencySection budgetPath="/b" />)

    await user.click(screen.getByRole("button", { name: /Request currency/i }))
    expect(shellOpen).toHaveBeenCalledWith("https://github.com/vladimir-e/capybudget")
  })
})
