import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { i18n } from "./config";

/**
 * Binds the shared i18next instance to the React tree. The instance
 * self-initializes on import, so this only scopes it for `Suspense`/context
 * and isn't strictly required for `t()` to resolve — but mounting it once at
 * the app root keeps the contract explicit.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
