import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { ExternalLink } from "lucide-react"
import { currencySymbol, type SymbolPosition } from "@capybudget/core"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

// A large amount with cents, so the preview shows grouping, symbol placement,
// and precision at once.
const PREVIEW_CENTS = 123456789

export function GeneralSection({ budgetPath }: { budgetPath: string }) {
  const { data, setName, setCurrency, setBudgetFormat } = useBudgetMeta(budgetPath)
  const { format: formatPreview } = useFormatMoney()

  // Uncontrolled, keyed on the stored name so an external change (or a reverted
  // commit) reseeds the field. Committed on blur / Enter, so a rename is one
  // file write rather than one per keystroke.
  const commitName = (value: string) => {
    const next = value.trim()
    if (next && next !== data.name) void setName(next)
  }

  const hasSymbol = currencySymbol(data.currency) !== ""

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Budget-wide basics.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="budget-name">Name</Label>
          <Input
            id="budget-name"
            key={data.name}
            defaultValue={data.name}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
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

        <p className="text-xs text-muted-foreground">
          Preview: <span className="text-foreground">{formatPreview(PREVIEW_CENTS)}</span>
        </p>
      </CardContent>
    </Card>
  )
}
