import { useEffect, useMemo, useState } from "react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { ChevronDown, ExternalLink } from "lucide-react"
import { useTranslation } from "@capybudget/i18n"
import {
  currencySymbol,
  defaultCurrencySettings,
  formatDefaultsFor,
  resolveRate,
  type CurrencySettings,
  type RateProvenance,
  type SymbolPosition,
} from "@capybudget/core"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { SettingsKey } from "@/lib/i18n-keys"
import { CurrencyCombobox } from "@/components/budget/currency-combobox"
import { useAccounts } from "@/hooks/use-budget-data"
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
  const { t } = useTranslation(["settings", "common"])
  const { data, setCurrency, setBudgetFormat, ensureCurrency, setCurrencyEntry } =
    useBudgetMeta(budgetPath)
  const { money: formatPreview } = useFormatters()
  const { data: accounts } = useAccounts()
  const [formatOpen, setFormatOpen] = useState(false)
  // The currency the user picked while foreign accounts exist — held until they
  // confirm, since switching the default re-bases every foreign stamp.
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null)

  const currency = data.defaultCurrency
  const { decimals, symbolPosition } = defaultCurrencySettings(data)

  const defaultFormat = formatDefaultsFor(currency)
  const isDefaultFormat =
    decimals === defaultFormat.decimals &&
    symbolPosition === defaultFormat.symbolPosition

  // Foreign currencies an account actually uses, distinct and stable-ordered.
  // The default is always handled above; only non-default account currencies
  // earn a row.
  const foreignCurrencies = useMemo(() => {
    const used = new Set<string>()
    for (const account of accounts ?? []) {
      if (account.currency !== currency) used.add(account.currency)
    }
    return [...used].sort()
  }, [accounts, currency])

  // Lazily seed an entry the first time a currency is in use, so its rate +
  // display settings persist thereafter — even after the last account on it is
  // deleted (persist-when-empty). A no-op once the entry exists.
  useEffect(() => {
    for (const code of foreignCurrencies) {
      if (!data.currencies[code]) void ensureCurrency(code)
    }
  }, [foreignCurrencies, data.currencies, ensureCurrency])

  // A single-currency budget re-denominates cleanly, so it switches with no
  // gate. With foreign accounts the switch is a lossy re-base — warn first.
  const handleCurrencyChange = (code: string) => {
    if (code === currency) return
    if (foreignCurrencies.length > 0) {
      setPendingCurrency(code)
      return
    }
    void setCurrency(code)
  }

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
            onChange={handleCurrencyChange}
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
            <FormatControls
              currency={currency}
              decimals={decimals}
              symbolPosition={symbolPosition}
              onChange={(format) => void setBudgetFormat(format)}
            />

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

        {foreignCurrencies.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <Label className="text-xs text-muted-foreground">
              {t("currency.exchangeRates", { currency })}
            </Label>
            {foreignCurrencies.map((code) => (
              <ForeignCurrencyRow
                key={code}
                code={code}
                defaultCurrency={currency}
                currencies={data.currencies}
                onChange={(update) => void setCurrencyEntry(code, update)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog
        open={pendingCurrency !== null}
        onOpenChange={(open) => { if (!open) setPendingCurrency(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("currency.switchWarning.title")}</DialogTitle>
            <DialogDescription>{t("currency.switchWarning.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingCurrency(null)}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingCurrency) void setCurrency(pendingCurrency)
                setPendingCurrency(null)
              }}
            >
              {t("currency.switchWarning.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// Symbol-position + decimals controls, shared by the default and foreign rows.
function FormatControls({
  currency,
  decimals,
  symbolPosition,
  onChange,
}: {
  currency: string
  decimals: number
  symbolPosition: SymbolPosition
  onChange: (format: { decimals: number; symbolPosition: SymbolPosition }) => void
}) {
  const { t } = useTranslation("settings")
  const hasSymbol = currencySymbol(currency) !== ""

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>{t("currency.symbol")}</Label>
        <ToggleGroup
          variant="outline"
          spacing={2}
          value={[symbolPosition]}
          onValueChange={(v) => {
            if (v.length === 0) return
            onChange({ decimals, symbolPosition: v[v.length - 1] as SymbolPosition })
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
        <Label htmlFor={`precision-${currency}`}>{t("currency.decimals")}</Label>
        <Select
          value={String(decimals)}
          onValueChange={(v) => {
            if (typeof v !== "string") return
            onChange({ decimals: Number(v), symbolPosition })
          }}
        >
          <SelectTrigger id={`precision-${currency}`} className="w-full">
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
  )
}

const PROVENANCE_KEY = {
  manual: "currency.rateManual",
  seed: "currency.rateSeed",
  unset: "currency.rateUnset",
} satisfies Record<RateProvenance, SettingsKey>

// Trim a seed-derived rate to a sane number of significant digits so the
// pre-filled input doesn't read like a float artifact (0.0109890109…).
function rateInputValue(rate: number): string {
  return String(Number(rate.toPrecision(6)))
}

function ForeignCurrencyRow({
  code,
  defaultCurrency,
  currencies,
  onChange,
}: {
  code: string
  defaultCurrency: string
  currencies: Record<string, CurrencySettings>
  onChange: (update: Partial<CurrencySettings>) => void
}) {
  const { t } = useTranslation("settings")
  const entry = currencies[code] ?? formatDefaultsFor(code)
  const resolved = resolveRate(code, currencies, defaultCurrency)

  // The input holds local edits until commit (blur/Enter) so an in-progress
  // "0." doesn't round-trip. Resetting the draft to the resolved value during
  // render — when the resolved rate changes out from under us — keeps the input
  // in sync without an effect.
  const [draft, setDraft] = useState(() => rateInputValue(resolved.rate))
  const [syncedRate, setSyncedRate] = useState(resolved.rate)
  if (resolved.rate !== syncedRate) {
    setSyncedRate(resolved.rate)
    setDraft(rateInputValue(resolved.rate))
  }

  const commitRate = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(rateInputValue(resolved.rate))
      return
    }
    if (parsed === resolved.rate) return
    onChange({ rate: parsed, rateSource: "manual" })
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">
          {code}{" "}
          <span className="text-muted-foreground">{currencySymbol(code)}</span>
        </span>
        <span className="text-xs text-muted-foreground">{t(PROVENANCE_KEY[resolved.source])}</span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <Label htmlFor={`rate-${code}`} className="shrink-0 text-muted-foreground">
          {t("currency.rateLabel", { code })}
        </Label>
        <Input
          id={`rate-${code}`}
          type="text"
          inputMode="decimal"
          className="h-8 w-28 tabular-nums"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRate}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
        />
        <span className="shrink-0 text-muted-foreground">{defaultCurrency}</span>
      </div>

      <FormatControls
        currency={code}
        decimals={entry.decimals}
        symbolPosition={entry.symbolPosition}
        onChange={onChange}
      />
    </div>
  )
}
