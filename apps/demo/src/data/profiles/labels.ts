import { useTranslation } from "@capybudget/i18n";
import type { DemoKey } from "@/lib/i18n-keys";

import type { DemoProfile } from "./types";

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
