import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { formatDefaultsFor } from "@capybudget/core"
import { CurrencyContext } from "@/contexts/currency-context"
import type { BarChartBlock, DonutChartBlock, TableBlock } from "@capybudget/intelligence"
import { BlockRenderer } from "./capy-block-renderer"

const table: TableBlock = {
  type: "table",
  headers: ["Category", "Amount"],
  rows: [
    ["Salary", "€5,000.00"],
    ["Rent", "-€1,200.00"],
  ],
}

const rubTable: TableBlock = {
  type: "table",
  headers: ["Category", "Amount"],
  rows: [
    ["Salary", "5,000 ₽"],
    ["Rent", "-1,200 ₽"],
  ],
}

function cell(container: HTMLElement, content: string): HTMLElement {
  const td = Array.from(container.querySelectorAll("td")).find(
    (el) => el.textContent === content,
  )
  if (!td) throw new Error(`cell not found: ${content}`)
  return td
}

describe("Capy chat table — currency-aware amount coloring", () => {
  it("colors income/expense cells by the budget symbol, not a hardcoded $", () => {
    const { container } = render(
      <CurrencyContext.Provider value={{ currency: "EUR", ...formatDefaultsFor("EUR") }}>
        <BlockRenderer block={table} isUser={false} />
      </CurrencyContext.Provider>,
    )

    expect(cell(container, "€5,000.00").className).toContain("text-amount-income")
    expect(cell(container, "-€1,200.00").className).toContain("text-amount-expense")
  })

  it("colors a symbol-after currency by the leading sign, not the trailing symbol", () => {
    const { container } = render(
      <CurrencyContext.Provider value={{ currency: "RUB", ...formatDefaultsFor("RUB") }}>
        <BlockRenderer block={rubTable} isUser={false} />
      </CurrencyContext.Provider>,
    )

    expect(cell(container, "5,000 ₽").className).toContain("text-amount-income")
    expect(cell(container, "-1,200 ₽").className).toContain("text-amount-expense")
  })
})

describe("Capy chart blocks — currency-formatted amounts (dollars → cents)", () => {
  // The render_chart contract carries amounts in DOLLARS; the renderer bridges
  // to the cents-based currency formatter, so $1,850.00 renders via the budget
  // currency rather than a hardcoded `$1850.00`.
  const bar: BarChartBlock = {
    type: "bar-chart",
    title: "Spending",
    data: [{ label: "Rent", value: 1850 }],
  }

  it("formats bar values through the budget currency", () => {
    const { container } = render(
      <CurrencyContext.Provider value={{ currency: "EUR", ...formatDefaultsFor("EUR") }}>
        <BlockRenderer block={bar} isUser={false} />
      </CurrencyContext.Provider>,
    )
    expect(container.textContent).toContain("€1,850.00")
    expect(container.textContent).not.toContain("$1850")
  })

  it("formats the donut center total through the budget currency", () => {
    const donut: DonutChartBlock = {
      type: "donut-chart",
      title: "Breakdown",
      data: [
        { label: "Rent", value: 1200 },
        { label: "Food", value: 800 },
      ],
    }
    const { container } = render(
      <CurrencyContext.Provider value={{ currency: "EUR", ...formatDefaultsFor("EUR") }}>
        <BlockRenderer block={donut} isUser={false} />
      </CurrencyContext.Provider>,
    )
    // 1200 + 800 = $2000 → compact (≥ $1000) drops decimals → "€2,000".
    expect(container.textContent).toContain("€2,000")
  })
})
