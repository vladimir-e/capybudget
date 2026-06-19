import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { i18n } from "./config";

// The instance self-initializes on import, so this isn't strictly required for
// `t()` to resolve — it only scopes the instance for `Suspense`/context.
export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
