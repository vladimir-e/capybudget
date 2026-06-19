import enCommon from "../locales/en/common.json";
import enSettings from "../locales/en/settings.json";
import enBudget from "../locales/en/budget.json";
import enImport from "../locales/en/import.json";
import enCapy from "../locales/en/capy.json";
import enOnboarding from "../locales/en/onboarding.json";
import enAnalytics from "../locales/en/analytics.json";
import enHelp from "../locales/en/help.json";
import enDemo from "../locales/en/demo.json";
import { SUPPORTED_LOCALES } from "./locales";

export const NAMESPACES = [
  "common",
  "settings",
  "budget",
  "analytics",
  "import",
  "capy",
  "onboarding",
  "help",
  "demo",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: Namespace = "common";

// `en` is imported statically so `react-i18next.d.ts` can derive the typed `t()`
// key space from it. Other locales only mirror `en`'s keys (enforced at runtime
// by `i18n:check`), so they need no type and load by glob below.
const en = {
  common: enCommon,
  settings: enSettings,
  budget: enBudget,
  analytics: enAnalytics,
  import: enImport,
  capy: enCapy,
  onboarding: enOnboarding,
  help: enHelp,
  demo: enDemo,
} as const;

// Eager so catalogs are in the first bundle and the first paint has the right
// language — i18next initializes synchronously.
const catalogs = import.meta.glob<Record<string, unknown>>("../locales/*/*.json", {
  eager: true,
  import: "default",
});

function loadCatalogs(locale: string): Record<Namespace, Record<string, unknown>> {
  return Object.fromEntries(
    NAMESPACES.map((ns) => {
      const mod = catalogs[`../locales/${locale}/${ns}.json`];
      if (!mod) {
        throw new Error(
          `i18n: missing catalog locales/${locale}/${ns}.json for a registered locale — ` +
            `run \`npm run i18n:check\` to see the parity gap.`,
        );
      }
      return [ns, mod];
    }),
  ) as Record<Namespace, Record<string, unknown>>;
}

export const resources = {
  en,
  ...Object.fromEntries(
    SUPPORTED_LOCALES.filter((l) => l.code !== "en").map((l) => [l.code, loadCatalogs(l.code)]),
  ),
} as const;
