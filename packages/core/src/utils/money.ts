// Grouping and decimal style come from this locale; symbol, position, and
// precision are explicit inputs. Locale detection is deferred.
const LOCALE = "en-US";

export const DEFAULT_CURRENCY = "USD";

// `off` drops the symbol entirely — the same result a symbol-less currency
// (CHF, AED…) collapses to under `before`/`after`.
export type SymbolPosition = "before" | "after" | "off";

export interface MoneyFormat {
  decimals: number;
  symbolPosition: SymbolPosition;
}

const decimalFormatters = new Map<number, Intl.NumberFormat>();

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

function compose(sign: string, num: string, symbol: string, position: SymbolPosition): string {
  if (position === "off" || symbol === "") return `${sign}${num}`;
  if (position === "after") return `${sign}${num} ${symbol}`;
  return `${sign}${symbol}${num}`;
}

export function formatMoney(
  cents: number,
  currency: string,
  format: MoneyFormat = formatDefaultsFor(currency),
): string {
  const sign = cents < 0 ? "-" : "";
  const num = decimalFormatter(format.decimals).format(Math.abs(cents) / 100);
  return compose(sign, num, currencySymbol(currency), format.symbolPosition);
}

// Drops the fractional part for large amounts (|cents| >= 100_000).
export function formatMoneyCompact(
  cents: number,
  currency: string,
  format: MoneyFormat = formatDefaultsFor(currency),
): string {
  if (Math.abs(cents) >= 100_000 && format.decimals > 0) {
    return formatMoney(cents, currency, { ...format, decimals: 0 });
  }
  return formatMoney(cents, currency, format);
}

const symbolFormatters = new Map<string, Intl.NumberFormat>();

// "" for currencies with no symbol: `narrowSymbol` returns the ISO code
// unchanged for them, which is how we detect the symbol-less case.
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

// Currencies whose conventional symbol trails the amount ("100 ₽", "1 234 zł").
const SYMBOL_AFTER = new Set([
  "RUB", "UAH", "KZT", "GEL", "AMD", "AZN", "UZS",
  "PLN", "CZK", "HUF", "RON", "SEK", "NOK", "DKK", "VND",
]);

// Currencies with no minor unit in everyday use — displaying cents blows up
// the figure ("Rp 13,900,000.00").
const ZERO_DECIMAL = new Set([
  "JPY", "KRW", "IDR", "VND", "CLP", "COP", "HUF", "RUB", "UZS",
]);

export const CURRENCY_FORMAT_DEFAULTS: Record<string, MoneyFormat> = Object.fromEntries(
  [...new Set([...SYMBOL_AFTER, ...ZERO_DECIMAL])].map((code) => [
    code,
    {
      decimals: ZERO_DECIMAL.has(code) ? 0 : 2,
      symbolPosition: SYMBOL_AFTER.has(code) ? "after" : "before",
    } satisfies MoneyFormat,
  ]),
);

export function formatDefaultsFor(currency: string): MoneyFormat {
  const curated = CURRENCY_FORMAT_DEFAULTS[currency];
  if (curated) return { ...curated };
  return { decimals: resolvedDecimals(currency), symbolPosition: "before" };
}

// All optional: additive `budget.json` fields with no schema bump, so any can
// be absent in a budget written before it existed.
export interface BudgetFormatFields {
  currency?: string;
  currencyDecimals?: number;
  currencySymbolPosition?: SymbolPosition;
}

// Money is stored as integer ×100, so a third display decimal always renders zero.
const MAX_DISPLAY_DECIMALS = 2;

// Single source of truth for the no-schema-bump backfill, shared by every reader
// (app meta parse, migrations, MCP server) so the contract can't drift.
export function resolveBudgetFormat(
  raw: BudgetFormatFields,
): { currency: string; decimals: number; symbolPosition: SymbolPosition } {
  const currency = raw.currency ?? DEFAULT_CURRENCY;
  const defaults = formatDefaultsFor(currency);
  const decimals = raw.currencyDecimals ?? defaults.decimals;
  return {
    currency,
    decimals: clampDecimals(decimals),
    symbolPosition: raw.currencySymbolPosition ?? defaults.symbolPosition,
  };
}

function clampDecimals(decimals: number): number {
  return Math.max(0, Math.min(MAX_DISPLAY_DECIMALS, decimals));
}

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
