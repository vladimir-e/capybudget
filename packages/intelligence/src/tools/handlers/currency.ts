/**
 * Builds the analytics converter the tool handlers use to roll money up into
 * the budget's default currency. With no currency settings (a single-currency
 * budget) every rate is 1.0, so this is the identity function and nothing moves.
 */

import {
  IDENTITY_CONVERTER,
  buildTodayRates,
  createConverter,
  SEED_RATES,
  type CurrencyConverter,
  type CurrencySettings,
} from "@capybudget/core"

export function toolConverter(
  defaultCurrency: string,
  currencies?: Record<string, CurrencySettings>,
): CurrencyConverter {
  if (!currencies) return IDENTITY_CONVERTER
  return createConverter(
    buildTodayRates(currencies, defaultCurrency, SEED_RATES),
    defaultCurrency,
  )
}
