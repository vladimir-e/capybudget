// Fixed display locale; only the currency symbol and minor-unit precision vary
// by the budget's chosen currency. Locale detection is deferred.
const LOCALE = "en-US";

/** Fallback currency for budgets without one set (e.g. a pre-currency
 *  budget.json) and the default for newly created budgets. */
export const DEFAULT_CURRENCY = "USD";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = compact ? `${currency}:compact` : currency;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      ...(compact ? { maximumFractionDigits: 0 } : {}),
    });
    formatters.set(key, fmt);
  }
  return fmt;
}

/** Format cents as a display string: 1250 → "$12.50" (USD), 1000 → "¥10" (JPY) */
export function formatMoney(cents: number, currency: string): string {
  return formatter(currency, false).format(cents / 100);
}

/** Format cents compactly: drop the fractional part when |amount| >= 100_000 cents.
 *  123456 → "$1,234", 999 → "$9.99". Currency-aware. */
export function formatMoneyCompact(cents: number, currency: string): string {
  if (Math.abs(cents) >= 100_000) {
    return formatter(currency, true).format(cents / 100);
  }
  return formatMoney(cents, currency);
}

/** The currency symbol alone: "USD" → "$", "EUR" → "€", "JPY" → "¥". */
export function currencySymbol(currency: string): string {
  const parts = formatter(currency, false).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
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
