import { useState } from "react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { ChevronDown, ExternalLink } from "lucide-react"
import {
  currencySymbol,
  formatDefaultsFor,
  type SymbolPosition,
} from "@capybudget/core"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { CurrencyCombobox } from "@/components/budget/currency-combobox"
import { useBudgetMeta } from "@/hooks/use-budget-meta"
import { useFormatMoney } from "@/contexts/currency-context"

// The plain repo page rather than `issues/new` — the latter bounces signed-out
// users to a GitHub login wall, which reads as a dead end.
const CURRENCY_REQUEST_URL = "https://github.com/vladimir-e/capybudget"

const SYMBOL_POSITIONS: { value: SymbolPosition; label: string }[] = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "off", label: "Off" },
]

const PRECISIONS = [0, 1, 2, 3]

// A positive (income) and a negative (expense) sample, each a few thousand
// major units with cents, so the preview shows grouping, symbol placement, and
// precision at once — and mirrors the transaction table's green/red amounts.
const PREVIEW_INCOME_CENTS = 421550
const PREVIEW_EXPENSE_CENTS = -128900

export function CurrencySection({ budgetPath }: { budgetPath: string }) {
  const { data, setCurrency, setBudgetFormat } = useBudgetMeta(budgetPath)
  const { format: formatPreview } = useFormatMoney()
  const [formatOpen, setFormatOpen] = useState(false)

  const hasSymbol = currencySymbol(data.currency) !== ""

  const defaultFormat = formatDefaultsFor(data.currency)
  const isDefaultFormat =
    data.currencyDecimals === defaultFormat.decimals &&
    data.currencySymbolPosition === defaultFormat.symbolPosition

  return (
    <Card>
      <CardHeader>
        <CardTitle>Currency</CardTitle>
        <CardDescription>How amounts are displayed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <CurrencyCombobox
            id="currency"
            value={data.currency}
            onChange={(code) => void setCurrency(code)}
          />
          <p className="text-xs text-muted-foreground">
            Changes display only — your balances aren’t converted.{" "}
            <button
              type="button"
              className="inline-flex items-center gap-1 underline hover:text-foreground transition-colors"
              onClick={() => void shellOpen(CURRENCY_REQUEST_URL)}
            >
              Request currency
              <ExternalLink className="size-3" />
            </button>
          </p>
        </div>

        <Collapsible open={formatOpen} onOpenChange={setFormatOpen} className="space-y-2">
          <div className="flex h-4 items-center justify-between">
            <Label className="text-xs text-muted-foreground">Preview</Label>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground transition-colors">
              Format settings
              <ChevronDown
                className={`size-3 transition-transform ${formatOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
          </div>

          <div className="flex items-center gap-6 rounded-md border bg-muted/30 px-3 py-2 text-sm font-semibold tabular-nums">
            <span className="text-amount-income">{formatPreview(PREVIEW_INCOME_CENTS)}</span>
            <span className="text-amount-expense">{formatPreview(PREVIEW_EXPENSE_CENTS)}</span>
          </div>

          <CollapsibleContent className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Symbol</Label>
                <ToggleGroup
                  variant="outline"
                  spacing={2}
                  value={[data.currencySymbolPosition]}
                  onValueChange={(v) => {
                    if (v.length === 0) return
                    void setBudgetFormat({
                      decimals: data.currencyDecimals,
                      symbolPosition: v[v.length - 1] as SymbolPosition,
                    })
                  }}
                  disabled={!hasSymbol}
                >
                  {SYMBOL_POSITIONS.map((p) => (
                    <ToggleGroupItem
                      key={p.value}
                      value={p.value}
                      className="aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-brand"
                    >
                      {p.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {!hasSymbol && (
                  <p className="text-xs text-muted-foreground">
                    {data.currency} has no symbol, so position has no effect.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="precision">Decimals</Label>
                <Select
                  value={String(data.currencyDecimals)}
                  onValueChange={(v) => {
                    if (typeof v !== "string") return
                    void setBudgetFormat({
                      decimals: Number(v),
                      symbolPosition: data.currencySymbolPosition,
                    })
                  }}
                >
                  <SelectTrigger id="precision" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRECISIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!isDefaultFormat && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                  onClick={() => void setBudgetFormat(defaultFormat)}
                >
                  Reset to {data.currency} defaults
                </button>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
