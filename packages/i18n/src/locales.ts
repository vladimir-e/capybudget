export interface LocaleMeta {
  /** i18next language code, also the BCP-47 tag passed to Intl formatters. */
  code: string;
  /** Endonym shown in the language picker. */
  label: string;
  /** English name of the language, injected into AI system prompts. */
  aiLanguage: string;
}

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English", aiLanguage: "English" },
  { code: "ru", label: "Русский", aiLanguage: "Russian" },
] as const satisfies readonly LocaleMeta[];

export type Locale = (typeof SUPPORTED_LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

const SUPPORTED_CODES = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code));

export function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_CODES.has(value);
}

/**
 * Map any BCP-47 tag onto the supported set, matching on the primary
 * subtag so "ru-RU" and "en-GB" resolve. Unknown tags fall back to English.
 */
export function normalizeLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const primary = tag.toLowerCase().split("-")[0];
  return isSupportedLocale(primary) ? primary : DEFAULT_LOCALE;
}

/** English name of a locale's language, for AI system-prompt injection. */
export function aiLanguageFor(locale: Locale): string {
  return SUPPORTED_LOCALES.find((l) => l.code === locale)!.aiLanguage;
}
