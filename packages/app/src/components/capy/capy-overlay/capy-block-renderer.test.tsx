import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { CurrencyContext } from "@/contexts/currency-context"
import type { TableBlock } from "@capybudget/intelligence"
import { BlockRenderer } from "./capy-block-renderer"

const table: TableBlock = {
  type: "table",
  headers: ["Category", "Amount"],
  rows: [
    ["Salary", "€5,000.00"],
    ["Rent", "-€1,200.00"],
  ],
}

/** The <td> whose text matches `content`. */
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
      <CurrencyContext.Provider value="EUR">
        <BlockRenderer block={table} isUser={false} />
      </CurrencyContext.Provider>,
    )

    expect(cell(container, "€5,000.00").className).toContain("text-amount-income")
    expect(cell(container, "-€1,200.00").className).toContain("text-amount-expense")
  })
})
