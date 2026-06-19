import "./config";

export { i18n, setLocale } from "./config";
export { I18nProvider } from "./provider";
export { useLocale, useAiLanguage, useTranslation } from "./hooks";
export { SUPPORTED_LOCALES, normalizeLocale, isSupportedLocale } from "./locales";
export type { Locale } from "./locales";
