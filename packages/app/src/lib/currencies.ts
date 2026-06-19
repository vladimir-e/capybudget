// Hand-curated rather than enumerated from `Intl.supportedValuesOf`, whose long
// tail drags in dead codes (RUR, etc.) with no friendly names. Display names
// live in the `budget:currencyName.*` catalog (resolved via `useCurrencyName`);
// this module is the canonical, relevance-ordered code list only.
export const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "JPY", "CNY", "CHF", "CAD", "AUD", "NZD", "HKD",
  "SGD", "INR", "KRW", "TWD", "THB", "MYR", "IDR", "PHP", "VND", "PKR",
  "BDT", "RUB", "UAH", "KZT", "GEL", "AMD", "AZN", "UZS", "TRY", "PLN",
  "CZK", "HUF", "RON", "SEK", "NOK", "DKK", "ILS", "AED", "SAR", "ZAR",
  "EGP", "NGN", "MXN", "BRL", "ARS", "CLP", "COP",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];
