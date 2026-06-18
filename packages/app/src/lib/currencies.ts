/**
 * Currency-list policy for the picker: a curated set of common currencies
 * surfaced first, then every other ISO 4217 code the runtime knows. The
 * combobox renders curated as one group and the rest as another. This is an
 * app concern — core stays currency-agnostic.
 */

export interface CurrencyOption {
  code: string;
  name: string;
}

/** Common currencies, in rough order of global prevalence. Rendered first. */
export const CURATED_CURRENCIES: readonly CurrencyOption[] = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "INR", name: "Indian Rupee" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "RUB", name: "Russian Ruble" },
  { code: "KRW", name: "South Korean Won" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "DKK", name: "Danish Krone" },
  { code: "PLN", name: "Polish Zloty" },
  { code: "ZAR", name: "South African Rand" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "AED", name: "UAE Dirham" },
  { code: "THB", name: "Thai Baht" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "ILS", name: "Israeli Shekel" },
  { code: "CZK", name: "Czech Koruna" },
  { code: "PHP", name: "Philippine Peso" },
];

const CURATED_CODES = new Set(CURATED_CURRENCIES.map((c) => c.code));

/** Every ISO 4217 code the runtime can enumerate, minus the curated ones,
 *  alphabetical. `Intl.supportedValuesOf` is optional — when it's absent the
 *  rest is empty and only the curated list shows. The code stands in as the
 *  name; no friendly-name library. */
function enumerateRest(): CurrencyOption[] {
  const supported = Intl.supportedValuesOf?.("currency") ?? [];
  return supported
    .filter((code) => !CURATED_CODES.has(code))
    .sort()
    .map((code) => ({ code, name: code }));
}

export const REST_CURRENCIES: readonly CurrencyOption[] = enumerateRest();

/** Curated first, then the rest — the full pickable list. */
export const ALL_CURRENCIES: readonly CurrencyOption[] = [
  ...CURATED_CURRENCIES,
  ...REST_CURRENCIES,
];
