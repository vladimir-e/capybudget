import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { ExternalLink } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { ThemeToggle } from "@/components/theme-toggle";
import { BudgetTile } from "@/components/budget/budget-tile";
import bgDay from "@/assets/capy-bg-day.webp";
import bgNight from "@/assets/capy-bg-night.webp";

import { PROFILE_LIST } from "../data/profiles";
import type { DemoProfile } from "../data/profiles";
import { markScenarioEntered } from "../session-entry";

const PROFILE_STICKERS: Record<string, string> = {
  underwater: "/capy-tired.webp",
  "paycheck-to-paycheck": "/capy-saving.webp",
  "no-stress": "/capy-chilling.webp",
};

export function DemoBudgetSelector() {
  const navigate = useNavigate();
  const { theme, resolvedTheme } = useTheme();

  const isDark = (resolvedTheme ?? theme) === "dark";
  const bgUrl = isDark ? bgNight : bgDay;

  function handleSelect(profile: DemoProfile) {
    markScenarioEntered();
    void navigate({
      to: "/budget",
      search: { path: profile.id, name: profile.name },
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
        <ThemeToggle />
      </div>

      {/* Centered glass card */}
      <div className="relative z-0 flex h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/40 bg-card/85 p-8 shadow-overlay backdrop-blur-md dark:bg-card/70">
          {/* Eyebrow + title + subtitle */}
          <div className="space-y-1 mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 font-mono">
              Demo
            </p>
            <h1 className="text-3xl font-bold tracking-tight">Capy Budget</h1>
            <p className="text-sm text-muted-foreground">
              Pick a scenario to explore.
            </p>
          </div>

          {/* Scenario tiles */}
          <div className="space-y-2">
            {PROFILE_LIST.map((profile) => (
              <BudgetTile
                key={profile.id}
                title={profile.name}
                subtitle={profile.description}
                icon={
                  <img
                    src={PROFILE_STICKERS[profile.id]}
                    alt=""
                    className="h-8 w-8 shrink-0 object-contain"
                  />
                }
                onClick={() => handleSelect(profile)}
              />
            ))}
          </div>

          {/* Footer — link to the marketing site. */}
          <div className="mt-6 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => { void openExternal("https://capybudget.app"); }}
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
