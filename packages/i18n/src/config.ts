import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, NAMESPACES, DEFAULT_NAMESPACE } from "./resources";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type Locale,
} from "./locales";

const STORAGE_KEY = "capybudget.language";

// This config self-initializes at module-eval, before any React error boundary
// mounts. Storage-partitioned webviews and Safari private mode throw on
// `localStorage` access, so an unguarded read here white-screens the whole app
// at boot. Reads fall through to detection; writes are best-effort.
function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Persistence is best-effort.
  }
}

// Synchronous so the first paint already has the right language — no flash of
// English. On the Tauri shell `navigator.language` is the OS locale, so no
// separate native call is needed.
function detectInitialLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return normalizeLocale(stored);
  if (typeof navigator !== "undefined") {
    return normalizeLocale(navigator.language);
  }
  return DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  ns: NAMESPACES,
  defaultNS: DEFAULT_NAMESPACE,
  interpolation: {
    // React escapes on render; double-escaping mangles names with quotes/&.
    escapeValue: false,
  },
  // Plurals come from Intl.PluralRules — the default in v21+, no config needed.
});

export async function setLocale(locale: Locale): Promise<void> {
  writeStoredLocale(locale);
  await i18n.changeLanguage(locale);
}

export { i18n };
