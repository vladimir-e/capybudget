import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { makeAccount } from "@/test/factories"
import type { Account, BudgetMeta, CurrencySettings } from "@capybudget/core"
import { CurrencySection } from "./currency-section"

const setBudgetFormat = vi.fn()
const ensureCurrency = vi.fn()
const setCurrencyEntry = vi.fn()
const rebaseCurrency = vi.fn()

let meta: BudgetMeta
let accounts: Account[]

vi.mock("@/hooks/use-budget-meta", () => ({
  useBudgetMeta: () => ({
    data: meta,
    isLoading: false,
    setBudgetFormat,
    ensureCurrency,
    setCurrencyEntry,
    save: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-rebase-currency", () => ({
  useRebaseCurrency: () => rebaseCurrency,
}))

vi.mock("@/hooks/use-budget-data", () => ({
  useAccounts: () => ({ data: accounts }),
}))

// A single-currency budget whose default entry carries the given display
// settings — the only entry the section reads.
function metaWith(
  currency = "USD",
  settings: CurrencySettings = { decimals: 2, symbolPosition: "before" },
  foreign: Record<string, CurrencySettings> = {},
): BudgetMeta {
  return {
    schemaVersion: 4,
    name: "My Budget",
    defaultCurrency: currency,
    currencies: { [currency]: settings, ...foreign },
    createdAt: "",
    lastModified: "",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  meta = metaWith()
  accounts = [makeAccount({ currency: "USD" })]
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
    accounts = [makeAccount({ currency: "CHF" })]
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

  it("shows the display-only notice for a single-currency budget but hides it once a foreign account exists", () => {
    const notice = /Changes display only/i

    const single = render(<CurrencySection budgetPath="/b" />)
    expect(screen.getByText(notice)).toBeInTheDocument()
    single.unmount()

    // With a foreign account a switch rebases (a real conversion), so the
    // "balances aren't converted" line would be false — it's hidden.
    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)
    expect(screen.queryByText(notice)).not.toBeInTheDocument()
  })

  it("renders no foreign rows for a USD-only budget (the invariant)", () => {
    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "USD" })]
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.queryByText(/Exchange rates/i)).not.toBeInTheDocument()
    expect(ensureCurrency).not.toHaveBeenCalled()
  })

  it("renders a foreign row with the seed rate and 'our estimate' provenance", () => {
    // A EUR account against a USD default, with no entry in the map yet.
    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.getByText(/Exchange rates to USD/i)).toBeInTheDocument()
    expect(screen.getByText("1 EUR =")).toBeInTheDocument()
    expect(screen.getByText(/our estimate/i)).toBeInTheDocument()
    // 1 EUR in USD = 1/0.92 ≈ 1.08696, trimmed to 6 sig digits.
    expect(screen.getByLabelText("1 EUR =")).toHaveValue("1.08696")
  })

  it("seeds an in-use foreign currency that has no entry yet", () => {
    accounts = [makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)
    expect(ensureCurrency).toHaveBeenCalledWith("EUR")
  })

  it("does not re-seed a foreign currency that already has an entry", () => {
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before", rate: 1.1, rateSource: "manual" },
    })
    accounts = [makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)
    expect(ensureCurrency).not.toHaveBeenCalled()
  })

  it("shows a manual rate with 'your rate' provenance", () => {
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before", rate: 1.2, rateSource: "manual" },
    })
    accounts = [makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.getByLabelText("1 EUR =")).toHaveValue("1.2")
    expect(screen.getByText(/your rate/i)).toBeInTheDocument()
  })

  it("commits an edited rate as a manual override", async () => {
    const user = userEvent.setup()
    accounts = [makeAccount({ currency: "EUR" })]
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before" },
    })
    render(<CurrencySection budgetPath="/b" />)

    const input = screen.getByLabelText("1 EUR =")
    await user.clear(input)
    await user.type(input, "1.15")
    await user.tab()

    expect(setCurrencyEntry).toHaveBeenCalledWith("EUR", { rate: 1.15, rateSource: "manual" })
  })

  it("does not rewrite a seed estimate as manual when the rate field is focused and blurred unedited", async () => {
    const user = userEvent.setup()
    accounts = [makeAccount({ currency: "EUR" })]
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before" }, // no manual rate → seed estimate
    })
    render(<CurrencySection budgetPath="/b" />)

    // The shown value is the seed estimate trimmed to 6 sig digits (1.08696),
    // narrower than the full-precision resolved rate. Tabbing past it must be a
    // no-op, not a silent manual override a hair off the real seed.
    const input = screen.getByLabelText("1 EUR =")
    expect(input).toHaveValue("1.08696")
    await user.click(input)
    await user.tab()

    expect(setCurrencyEntry).not.toHaveBeenCalled()
    expect(screen.getByText(/our estimate/i)).toBeInTheDocument()
  })

  it("still commits a genuinely edited seed rate as a manual override", async () => {
    const user = userEvent.setup()
    accounts = [makeAccount({ currency: "EUR" })]
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before" }, // seed estimate baseline
    })
    render(<CurrencySection budgetPath="/b" />)

    const input = screen.getByLabelText("1 EUR =")
    await user.clear(input)
    await user.type(input, "2")
    await user.tab()

    expect(setCurrencyEntry).toHaveBeenCalledWith("EUR", { rate: 2, rateSource: "manual" })
  })

  it("offers 'use our estimate' on a manual rate and clears the override on click", async () => {
    const user = userEvent.setup()
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before", rate: 1.2, rateSource: "manual" },
    })
    accounts = [makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)

    await user.click(screen.getByRole("button", { name: /use our estimate/i }))
    expect(setCurrencyEntry).toHaveBeenCalledWith("EUR", { rate: undefined, rateSource: undefined })
  })

  it("shows no reset link when the rate is already our estimate", () => {
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before" }, // no manual rate → seed estimate
    })
    accounts = [makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.getByText(/our estimate/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /use our estimate/i })).not.toBeInTheDocument()
  })

  const openCurrencyPicker = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: /^USD/ }))

  it("switches with no warning for a single-currency budget", async () => {
    const user = userEvent.setup()
    accounts = [makeAccount({ currency: "USD" })]
    render(<CurrencySection budgetPath="/b" />)

    await openCurrencyPicker(user)
    await user.click(await screen.findByRole("option", { name: /Euro/i }))

    expect(screen.queryByText(/Switch default currency\?/i)).not.toBeInTheDocument()
    expect(rebaseCurrency).toHaveBeenCalledWith("EUR")
  })

  it("warns before switching when a foreign account exists, and only commits on confirm", async () => {
    const user = userEvent.setup()
    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)

    await openCurrencyPicker(user)
    await user.click(await screen.findByRole("option", { name: /British Pound/i }))

    // Warning shown, nothing committed yet.
    expect(screen.getByText(/Switch default currency\?/i)).toBeInTheDocument()
    expect(rebaseCurrency).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: /Switch to GBP/i }))
    expect(rebaseCurrency).toHaveBeenCalledWith("GBP")
  })

  it("cancelling the warning leaves the default currency unchanged", async () => {
    const user = userEvent.setup()
    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)

    await openCurrencyPicker(user)
    await user.click(await screen.findByRole("option", { name: /British Pound/i }))
    await user.click(screen.getByRole("button", { name: /Cancel/i }))

    expect(rebaseCurrency).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByText(/Switch default currency\?/i)).not.toBeInTheDocument(),
    )
  })

  it("previews a foreign row in that currency's own format, not the default's", () => {
    // RUB defaults to symbol-after, 0 decimals — visibly distinct from USD's
    // "$4,215.50". The preview box is always shown, so no expand needed.
    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "RUB" })]
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.getByText("4,216 ₽")).toHaveClass("text-amount-income")
    expect(screen.getByText("-1,289 ₽")).toHaveClass("text-amount-expense")
  })

  it("resets a diverged foreign format to that currency's defaults, leaving the rate untouched", async () => {
    // RUB account whose stored format diverges from RUB defaults (symbol before,
    // 2 decimals) and carries a manual rate.
    const user = userEvent.setup()
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      RUB: { decimals: 2, symbolPosition: "before", rate: 90, rateSource: "manual" },
    })
    accounts = [makeAccount({ currency: "RUB" })]
    render(<CurrencySection budgetPath="/b" />)

    // The RUB row owns the only Format settings trigger (USD is single-account → no
    // exchange section, but its default trigger is still present, so target the row's).
    const triggers = screen.getAllByRole("button", { name: /Format settings/i })
    await user.click(triggers[triggers.length - 1])
    await user.click(screen.getByRole("button", { name: /Reset to RUB defaults/i }))

    // Only the display knobs reset; rate/rateSource are absent from the partial.
    expect(setCurrencyEntry).toHaveBeenCalledWith("RUB", { decimals: 0, symbolPosition: "after" })
  })

  it("hides the foreign-format reset link when the format already matches the currency's defaults", async () => {
    const user = userEvent.setup()
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      RUB: { decimals: 0, symbolPosition: "after", rate: 90, rateSource: "manual" },
    })
    accounts = [makeAccount({ currency: "RUB" })]
    render(<CurrencySection budgetPath="/b" />)

    const triggers = screen.getAllByRole("button", { name: /Format settings/i })
    await user.click(triggers[triggers.length - 1])
    expect(screen.queryByRole("button", { name: /Reset to RUB defaults/i })).not.toBeInTheDocument()
  })

  it("shows the rate-history note only when foreign currencies exist", () => {
    const note = /past transactions keep the rate from the day they happened/i

    const single = render(<CurrencySection budgetPath="/b" />)
    expect(screen.queryByText(note)).not.toBeInTheDocument()
    single.unmount()

    accounts = [makeAccount({ currency: "USD" }), makeAccount({ currency: "EUR" })]
    render(<CurrencySection budgetPath="/b" />)
    expect(screen.getByText(note)).toBeInTheDocument()
  })

  it("keeps a foreign row for a persisted currency no account currently uses", () => {
    // Persist-when-empty: the entry stays in the map, but only in-use currencies
    // get a row — a deleted-last-account EUR with no EUR account shows nothing.
    meta = metaWith("USD", { decimals: 2, symbolPosition: "before" }, {
      EUR: { decimals: 2, symbolPosition: "before", rate: 1.1, rateSource: "manual" },
    })
    accounts = [makeAccount({ currency: "USD" })]
    render(<CurrencySection budgetPath="/b" />)

    expect(screen.queryByText("1 EUR =")).not.toBeInTheDocument()
  })
})
