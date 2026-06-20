export interface LocaleMeta {
  /** i18next catalog language code; the base of any region-bearing format tag. */
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

/** The catalog-language subtag of a BCP-47 tag: "en-GB" → "en". */
export function primarySubtag(tag: string): string {
  return tag.toLowerCase().split("-")[0];
}

// Matches on the primary subtag so "ru-RU" and "en-GB" resolve; unknown → en.
export function normalizeLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const primary = primarySubtag(tag);
  return isSupportedLocale(primary) ? primary : DEFAULT_LOCALE;
}

export function aiLanguageFor(locale: Locale): string {
  return SUPPORTED_LOCALES.find((l) => l.code === locale)!.aiLanguage;
}
