/**
 * Currency-list policy for the picker: a single hand-curated list of the
 * currencies Capy supports. Deliberately not enumerated from
 * `Intl.supportedValuesOf` — that long tail drags in dead codes (RUR, etc.)
 * with no friendly names. Users can request more via the Settings link. This
 * is an app concern — core stays currency-agnostic.
 */

export interface CurrencyOption {
  code: string;
  name: string;
}

/** Supported currencies, in rough order of relevance to Capy's users. */
export const CURRENCIES: readonly CurrencyOption[] = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "CNY", name: "Chinese Yuan" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "INR", name: "Indian Rupee" },
  { code: "KRW", name: "South Korean Won" },
  { code: "TWD", name: "Taiwan Dollar" },
  { code: "THB", name: "Thai Baht" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "VND", name: "Vietnamese Dong" },
  { code: "PKR", name: "Pakistani Rupee" },
  { code: "BDT", name: "Bangladeshi Taka" },
  { code: "RUB", name: "Russian Ruble" },
  { code: "UAH", name: "Ukrainian Hryvnia" },
  { code: "KZT", name: "Kazakhstani Tenge" },
  { code: "GEL", name: "Georgian Lari" },
  { code: "AMD", name: "Armenian Dram" },
  { code: "AZN", name: "Azerbaijani Manat" },
  { code: "UZS", name: "Uzbekistani Som" },
  { code: "TRY", name: "Turkish Lira" },
  { code: "PLN", name: "Polish Zloty" },
  { code: "CZK", name: "Czech Koruna" },
  { code: "HUF", name: "Hungarian Forint" },
  { code: "RON", name: "Romanian Leu" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "NOK", name: "Norwegian Krone" },
  { code: "DKK", name: "Danish Krone" },
  { code: "ILS", name: "Israeli Shekel" },
  { code: "AED", name: "UAE Dirham" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "ZAR", name: "South African Rand" },
  { code: "EGP", name: "Egyptian Pound" },
  { code: "NGN", name: "Nigerian Naira" },
  { code: "MXN", name: "Mexican Peso" },
  { code: "BRL", name: "Brazilian Real" },
  { code: "ARS", name: "Argentine Peso" },
  { code: "CLP", name: "Chilean Peso" },
  { code: "COP", name: "Colombian Peso" },
];
