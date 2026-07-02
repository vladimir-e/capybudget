import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "@capybudget/i18n";

import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelect } from "@/components/settings/language-select";
import { BudgetTile } from "@/components/budget/budget-tile";
import bgDay from "@/assets/capy-bg-day.webp";
import bgNight from "@/assets/capy-bg-night.webp";

import { PROFILE_LIST } from "../data/profiles";
import { useScenarioLabels } from "../data/profiles/labels";
import { markScenarioEntered } from "../session-entry";

const PROFILE_STICKERS: Record<string, string> = {
  underwater: "/capy-tired.webp",
  "paycheck-to-paycheck": "/capy-saving.webp",
  "no-stress": "/capy-chilling.webp",
};

export function DemoBudgetSelector() {
  const { t } = useTranslation("demo");
  const scenarioLabels = useScenarioLabels();
  const navigate = useNavigate();
  const { theme, resolvedTheme } = useTheme();

  const isDark = (resolvedTheme ?? theme) === "dark";
  const bgUrl = isDark ? bgNight : bgDay;

  function handleSelect(profileId: string, name: string) {
    markScenarioEntered();
    void navigate({
      to: "/budget",
      search: { path: profileId, name },
    });
  }

  return (
    <>
      {/* Full-bleed background */}
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgUrl})` }}
        aria-hidden
      />

      {/* Top-right controls */}
      <div className="fixed top-4 right-4 z-10 flex items-center gap-1">
        <LanguageSelect withIcon className="border-transparent bg-transparent hover:bg-accent/50 dark:bg-transparent" />
        <ThemeToggle />
      </div>

      {/* Centered glass card */}
      <div className="relative z-0 flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card/85 p-8 shadow-overlay backdrop-blur-md dark:bg-card/70">
          {/* Eyebrow + title + subtitle */}
          <div className="space-y-1 mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 font-mono">
              {t("selector.eyebrow")}
            </p>
            <h1 className="text-3xl font-bold tracking-tight">Capy Budget</h1>
            <p className="text-sm text-muted-foreground">
              {t("selector.subtitle")}
            </p>
          </div>

          {/* Scenario tiles */}
          <div className="space-y-2">
            {PROFILE_LIST.map((profile) => {
              const { name, description } = scenarioLabels(profile);
              return (
                <BudgetTile
                  key={profile.id}
                  title={name}
                  subtitle={description}
                  icon={
                    <img
                      src={PROFILE_STICKERS[profile.id]}
                      alt=""
                      className="h-8 w-8 shrink-0 object-contain"
                    />
                  }
                  onClick={() => handleSelect(profile.id, name)}
                />
              );
            })}
          </div>

          {/* Footer — link to the marketing site. */}
          <div className="mt-6 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => { void openUrl("https://capybudget.app"); }}
            >
              capybudget.app
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
