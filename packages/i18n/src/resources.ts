import enCommon from "../locales/en/common.json";
import enSettings from "../locales/en/settings.json";
import enBudget from "../locales/en/budget.json";
import enImport from "../locales/en/import.json";
import enCapy from "../locales/en/capy.json";
import enOnboarding from "../locales/en/onboarding.json";

import ruCommon from "../locales/ru/common.json";
import ruSettings from "../locales/ru/settings.json";
import ruBudget from "../locales/ru/budget.json";
import ruImport from "../locales/ru/import.json";
import ruCapy from "../locales/ru/capy.json";
import ruOnboarding from "../locales/ru/onboarding.json";

export const NAMESPACES = [
  "common",
  "settings",
  "budget",
  "import",
  "capy",
  "onboarding",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export const DEFAULT_NAMESPACE: Namespace = "common";

export const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    budget: enBudget,
    import: enImport,
    capy: enCapy,
    onboarding: enOnboarding,
  },
  ru: {
    common: ruCommon,
    settings: ruSettings,
    budget: ruBudget,
    import: ruImport,
    capy: ruCapy,
    onboarding: ruOnboarding,
  },
} as const;
