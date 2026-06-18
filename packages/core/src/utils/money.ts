// Fixed display locale; grouping and decimal style come from it, while the
// currency symbol, its position, and precision are explicit, user-tunable
// inputs (see MoneyFormat). Locale detection is deferred.
const LOCALE = "en-US";

/** Fallback currency for budgets without one set (e.g. a pre-currency
 *  budget.json) and the default for newly created budgets. */
export const DEFAULT_CURRENCY = "USD";

/** Where the currency symbol sits relative to the number — or nowhere.
 *  `off` drops the symbol entirely (bare number); the same result a
 *  symbol-less currency (CHF, AED…) collapses to under `before`/`after`. */
export type SymbolPosition = "before" | "after" | "off";

/** A budget's money-formatting choices, decoupled from the currency so a user
 *  can tune them to match their real-world convention (RUB as "100 ₽",
 *  zero-decimal IDR, no symbol at all). Currency supplies only the symbol. */
export interface MoneyFormat {
  /** Minor-unit precision, 0–3. A 0-decimal display still stores ×100 cents. */
  decimals: number;
  symbolPosition: SymbolPosition;
}

const decimalFormatters = new Map<number, Intl.NumberFormat>();

/** Cached `decimal`-style formatter for a fixed precision: grouping + rounding,
 *  no currency styling. Keyed by `decimals` since that's its only variable. */
function decimalFormatter(decimals: number): Intl.NumberFormat {
  let fmt = decimalFormatters.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE, {
      style: "decimal",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    decimalFormatters.set(decimals, fmt);
  }
  return fmt;
}

/** Compose the symbol around a formatted, unsigned number, then prepend the
 *  sign. A symbol-less currency or `off` yields the bare number — no stray
 *  space. `before` hugs the number; `after` takes one separating space. */
function compose(sign: string, num: string, symbol: string, position: SymbolPosition): string {
  if (position === "off" || symbol === "") return `${sign}${num}`;
  if (position === "after") return `${sign}${num} ${symbol}`;
  return `${sign}${symbol}${num}`;
}

/** Format signed cents as a display string under an explicit format:
 *  `formatMoney(-10000, "USD", { decimals: 2, symbolPosition: "before" })`
 *  → "-$100.00"; `formatMoney(12345600, "RUB", { decimals: 0,
 *  symbolPosition: "after" })` → "123,456 ₽". Money stays integer cents;
 *  precision only rounds the display. */
export function formatMoney(cents: number, currency: string, format: MoneyFormat): string {
  const sign = cents < 0 ? "-" : "";
  const num = decimalFormatter(format.decimals).format(Math.abs(cents) / 100);
  return compose(sign, num, currencySymbol(currency), format.symbolPosition);
}

/** Like `formatMoney`, but drops the fractional part for large amounts
 *  (|cents| >= 100_000) — "$1,234" instead of "$1,234.56" — while keeping the
 *  chosen symbol composition. Below the threshold it defers to `formatMoney`. */
export function formatMoneyCompact(cents: number, currency: string, format: MoneyFormat): string {
  if (Math.abs(cents) >= 100_000 && format.decimals > 0) {
    return formatMoney(cents, currency, { ...format, decimals: 0 });
  }
  return formatMoney(cents, currency, format);
}

const symbolFormatters = new Map<string, Intl.NumberFormat>();

/** The currency symbol alone: "USD" → "$", "EUR" → "€", "JPY" → "¥".
 *  Returns "" for currencies with no symbol (CHF, AED…) — the ISO code is
 *  never used as a stand-in. `narrowSymbol` returns the code unchanged for
 *  symbol-less currencies, which is how we detect them. */
export function currencySymbol(currency: string): string {
  let fmt = symbolFormatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    });
    symbolFormatters.set(currency, fmt);
  }
  const symbol = fmt.formatToParts(0).find((p) => p.type === "currency")?.value;
  return symbol && symbol !== currency ? symbol : "";
}

/** Currencies whose conventional symbol trails the amount ("100 ₽", "1 234 zł).
 *  The rest default to a leading symbol. */
const SYMBOL_AFTER = new Set([
  "RUB", "UAH", "KZT", "GEL", "AMD", "AZN", "UZS",
  "PLN", "CZK", "HUF", "RON", "SEK", "NOK", "DKK", "VND",
]);

/** Currencies with no minor unit in everyday use — displaying cents blows up
 *  the figure ("Rp 13,900,000.00"). The rest default to 2 decimals. */
const ZERO_DECIMAL = new Set([
  "JPY", "KRW", "IDR", "VND", "CLP", "COP", "HUF", "RUB", "UZS",
]);

/** Curated default formatting per currency, overlaid on the Intl baseline.
 *  Materialized once so it can be reused as the backfill for budgets created
 *  before formatting was tunable, and as the reset target when currency
 *  changes. */
export const CURRENCY_FORMAT_DEFAULTS: Record<string, MoneyFormat> = Object.fromEntries(
  [...new Set([...SYMBOL_AFTER, ...ZERO_DECIMAL])].map((code) => [
    code,
    {
      decimals: ZERO_DECIMAL.has(code) ? 0 : 2,
      symbolPosition: SYMBOL_AFTER.has(code) ? "after" : "before",
    } satisfies MoneyFormat,
  ]),
);

/** The default `MoneyFormat` for a currency: the curated entry when one
 *  exists, otherwise a sensible baseline — `before` symbol with the currency's
 *  Intl-resolved minor-unit precision (2 for most, 0 for JPY-likes). Used to
 *  backfill budgets predating tunable formatting and to reset on a currency
 *  change. */
export function formatDefaultsFor(currency: string): MoneyFormat {
  const curated = CURRENCY_FORMAT_DEFAULTS[currency];
  if (curated) return { ...curated };
  return { decimals: resolvedDecimals(currency), symbolPosition: "before" };
}

/** The `budget.json` money fields, all optional — currency, decimals, and
 *  symbol position are additive columns with no schema bump, so any of them
 *  can be absent in a budget written before it existed. */
export interface BudgetFormatFields {
  currency?: string;
  currencyDecimals?: number;
  currencySymbolPosition?: SymbolPosition;
}

/** Resolve a budget's effective currency + format from its raw `budget.json`
 *  fields, backfilling each missing piece from the currency's curated defaults.
 *  The single source of truth for the no-schema-bump backfill, shared by every
 *  reader (app meta parse, migrations, MCP server) so the contract can't drift.
 *  Pure — no Tauri/node. */
export function resolveBudgetFormat(
  raw: BudgetFormatFields,
): { currency: string; decimals: number; symbolPosition: SymbolPosition } {
  const currency = raw.currency ?? DEFAULT_CURRENCY;
  const defaults = formatDefaultsFor(currency);
  return {
    currency,
    decimals: raw.currencyDecimals ?? defaults.decimals,
    symbolPosition: raw.currencySymbolPosition ?? defaults.symbolPosition,
  };
}

/** The minor-unit precision Intl resolves for a currency (2 for USD, 0 for
 *  JPY). Falls back to 2 if the code is unknown to the runtime. */
function resolvedDecimals(currency: string): number {
  try {
    const opts = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
    }).resolvedOptions();
    return opts.maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** CSS class for amount coloring based on transaction type */
export function getAmountClass(txn: { type: string; amount: number }): string {
  if (txn.type === "transfer") return "text-amount-transfer";
  if (txn.amount < 0) return "text-amount-expense";
  return "text-amount-income";
}

/** Format cents as an unsigned dollar string for editing: 1250 → "12.50" */
export function centsToEditString(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

/** Parse a dollar string to cents: "$12.50" → 1250, "12.5" → 1250 */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}
