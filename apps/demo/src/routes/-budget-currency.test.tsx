import { useEffect } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { CurrencyProvider } from "@/components/budget/currency-provider"
import { useFormatMoney } from "@/contexts/currency-context"
import { useBudgetMeta } from "@/hooks/use-budget-meta"

// Runs under the demo vite config: Tauri fs is the in-memory stub and
// __IS_DEMO__ is true — the exact environment the demo ships in.

afterEach(cleanup)

const BUDGET_PATH = "demo-scenario"
const AMOUNT_CENTS = 123456

type SetCurrency = (currency: string) => Promise<void>

function Amount() {
  const { format } = useFormatMoney()
  return <span data-testid="amount">{format(AMOUNT_CENTS)}</span>
}

// Hands the test the same setCurrency the Settings picker calls, bound to the
// same budgetPath the provider reads — so the round-trip mirrors the demo.
function CurrencyWriter({ onReady }: { onReady: (set: SetCurrency) => void }) {
  const { setCurrency } = useBudgetMeta(BUDGET_PATH)
  useEffect(() => onReady(setCurrency), [onReady, setCurrency])
  return null
}

function renderDemoTree(onReady: (set: SetCurrency) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CurrencyProvider budgetPath={BUDGET_PATH}>
        <Amount />
        <CurrencyWriter onReady={onReady} />
      </CurrencyProvider>
    </QueryClientProvider>,
  )
}

describe("demo currency switching", () => {
  it("reformats amounts when the budget currency changes", async () => {
    let setCurrency!: SetCurrency
    renderDemoTree((set) => {
      setCurrency = set
    })

    // Before any write the provider falls back to the USD default.
    await waitFor(() =>
      expect(screen.getByTestId("amount")).toHaveTextContent("$1,234.56"),
    )

    // EUR keeps the before-symbol layout but swaps the glyph.
    await act(() => setCurrency("EUR"))
    await waitFor(() =>
      expect(screen.getByTestId("amount")).toHaveTextContent("€1,234.56"),
    )

    // KZT moves the symbol after the amount — proves format fields, not just the
    // symbol, flow from budget.json through the provider.
    await act(() => setCurrency("KZT"))
    await waitFor(() =>
      expect(screen.getByTestId("amount")).toHaveTextContent("1,234.56 ₸"),
    )
  })
})
