import { useTranslation } from "react-i18next";
import { aiLanguageFor, normalizeLocale, type Locale } from "./locales";

/**
 * The active locale as reactive state — re-renders on `changeLanguage`.
 * Consumers that format with `Intl` (money, dates) read this so a language
 * switch reflows their output without a manual subscription.
 */
export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
}

/** English name of the active language, for AI system-prompt injection. */
export function useAiLanguage(): string {
  return aiLanguageFor(useLocale());
}

export { useTranslation };
