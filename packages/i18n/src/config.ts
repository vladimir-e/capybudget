import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, NAMESPACES, DEFAULT_NAMESPACE } from "./resources";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  primarySubtag,
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

// Resolves the full BCP-47 format tag, gated on language support: a region-
// bearing tag is kept whole ("en-GB" stays "en-GB") only when its language is
// supported, so i18next resolves it to the base catalog while the region drives
// Intl formatting. An unsupported language collapses to the default — we don't
// want es-MX number formatting under an English UI. The stored value may be a
// legacy bare code or a full tag; both work, a bare code just means no region.
//
// Synchronous so the first paint already has the right language — no flash of
// English. On the Tauri shell `navigator.language` is the OS locale, so no
// separate native call is needed.
function detectInitialLocale(): string {
  const stored = readStoredLocale();
  if (stored) return gateToSupported(stored);
  if (typeof navigator !== "undefined") {
    return gateToSupported(navigator.language);
  }
  return DEFAULT_LOCALE;
}

function gateToSupported(tag: string): string {
  return isSupportedLocale(primarySubtag(tag)) ? tag : DEFAULT_LOCALE;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  // A region-bearing tag ("en-GB") resolves to its base catalog ("en") while
  // i18n.language keeps the region for Intl; nonExplicit covers any region.
  supportedLngs: SUPPORTED_LOCALES.map((l) => l.code),
  nonExplicitSupportedLngs: true,
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
