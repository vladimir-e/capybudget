import { useTranslation } from "@capybudget/i18n";
import type { DemoKey } from "@/lib/i18n-keys";

import type { DemoProfile } from "./types";

/** The `demo:scenarios.*` keys for a profile. Typed `DemoKey` so the compiler
 *  pins each to a real catalog key; `i18n:check` enforces locale parity. The
 *  scenario `name`/`description` are the profile's only user-visible copy — the
 *  rest of the profile is financial config the engine consumes, never rendered. */
const SCENARIO_KEY = {
  underwater: {
    name: "scenarios.underwater.name",
    description: "scenarios.underwater.description",
  },
  "paycheck-to-paycheck": {
    name: "scenarios.paycheck-to-paycheck.name",
    description: "scenarios.paycheck-to-paycheck.description",
  },
  "no-stress": {
    name: "scenarios.no-stress.name",
    description: "scenarios.no-stress.description",
  },
} satisfies Record<string, { name: DemoKey; description: DemoKey }>;

export interface ScenarioLabels {
  name: string;
  description: string;
}

/** Localizes a profile's user-visible name + description off its id. Falls back
 *  to the profile's own strings for any id without catalog keys — which never
 *  fires for the shipped profiles, but keeps an unkeyed scenario readable. */
export function useScenarioLabels(): (profile: DemoProfile) => ScenarioLabels {
  const { t } = useTranslation("demo");
  return (profile) => {
    if (!Object.hasOwn(SCENARIO_KEY, profile.id)) {
      return { name: profile.name, description: profile.description };
    }
    const keys = SCENARIO_KEY[profile.id as keyof typeof SCENARIO_KEY];
    return { name: t(keys.name), description: t(keys.description) };
  };
}
