import { useState } from "react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { ChevronDown, ExternalLink } from "lucide-react"
import { useTranslation } from "@capybudget/i18n"
import {
  currencySymbol,
  defaultCurrencySettings,
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
import { useFormatters } from "@/hooks/use-formatters"

// The plain repo page rather than `issues/new` — the latter bounces signed-out
// users to a GitHub login wall, which reads as a dead end.
const CURRENCY_REQUEST_URL = "https://github.com/vladimir-e/capybudget"

const SYMBOL_POSITIONS: SymbolPosition[] = ["before", "after", "off"]

const PRECISIONS = [0, 1, 2]

// Income/expense samples large enough to show grouping, symbol, and precision at once.
const PREVIEW_INCOME_CENTS = 421550
const PREVIEW_EXPENSE_CENTS = -128900

export function CurrencySection({ budgetPath }: { budgetPath: string }) {
  const { t } = useTranslation("settings")
  const { data, setCurrency, setBudgetFormat } = useBudgetMeta(budgetPath)
  const { money: formatPreview } = useFormatters()
  const [formatOpen, setFormatOpen] = useState(false)

  const currency = data.defaultCurrency
  const { decimals, symbolPosition } = defaultCurrencySettings(data)
  const hasSymbol = currencySymbol(currency) !== ""

  const defaultFormat = formatDefaultsFor(currency)
  const isDefaultFormat =
    decimals === defaultFormat.decimals &&
    symbolPosition === defaultFormat.symbolPosition

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("currency.title")}</CardTitle>
        <CardDescription>{t("currency.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <CurrencyCombobox
            id="currency"
            value={currency}
            onChange={(code) => void setCurrency(code)}
          />
          <p className="text-xs text-muted-foreground">
            {t("currency.changeNotice")}{" "}
            <button
              type="button"
              className="inline-flex items-center gap-1 underline hover:text-foreground transition-colors"
              onClick={() => void shellOpen(CURRENCY_REQUEST_URL)}
            >
              {t("currency.requestCurrency")}
              <ExternalLink className="size-3" />
            </button>
          </p>
        </div>

        <Collapsible open={formatOpen} onOpenChange={setFormatOpen} className="space-y-2">
          <div className="flex h-4 items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("currency.preview")}</Label>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground transition-colors">
              {t("currency.formatSettings")}
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
                <Label>{t("currency.symbol")}</Label>
                <ToggleGroup
                  variant="outline"
                  spacing={2}
                  value={[symbolPosition]}
                  onValueChange={(v) => {
                    if (v.length === 0) return
                    void setBudgetFormat({
                      decimals,
                      symbolPosition: v[v.length - 1] as SymbolPosition,
                    })
                  }}
                  disabled={!hasSymbol}
                >
                  {SYMBOL_POSITIONS.map((p) => (
                    <ToggleGroupItem
                      key={p}
                      value={p}
                      className="aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-brand"
                    >
                      {t(`currency.symbolPosition.${p}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {!hasSymbol && (
                  <p className="text-xs text-muted-foreground">
                    {t("currency.noSymbol", { currency })}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="precision">{t("currency.decimals")}</Label>
                <Select
                  value={String(decimals)}
                  onValueChange={(v) => {
                    if (typeof v !== "string") return
                    void setBudgetFormat({
                      decimals: Number(v),
                      symbolPosition,
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
                  {t("currency.resetDefaults", { currency })}
                </button>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
