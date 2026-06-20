import { useTranslation } from "react-i18next";
import { aiLanguageFor, normalizeLocale, type Locale } from "./locales";

// The catalog language (en/ru). Reactive: re-renders on `changeLanguage`, so
// consumers that select translations or content reflow on a language switch.
export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
}

// The full BCP-47 format tag (en-GB, ru-RU) for Intl formatters. Region comes
// from OS detection while the catalog stays collapsed to `useLocale()`; a bare
// language tag just means no region. Reactive via the same subscription.
export function useFormatLocale(): string {
  const { i18n } = useTranslation();
  return i18n.language;
}

export function useAiLanguage(): string {
  return aiLanguageFor(useLocale());
}

export { useTranslation };
