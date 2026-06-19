import { useTranslation } from "react-i18next";
import { aiLanguageFor, normalizeLocale, type Locale } from "./locales";

// Reactive: re-renders on `changeLanguage`, so Intl-formatting consumers (money,
// dates) reflow on a language switch without a manual subscription.
export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language);
}

export function useAiLanguage(): string {
  return aiLanguageFor(useLocale());
}

export { useTranslation };
