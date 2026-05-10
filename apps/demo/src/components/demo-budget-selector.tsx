import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";

import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { BudgetTile } from "@/components/budget/budget-tile";
import bgDay from "@/assets/capy-bg-day.avif";
import bgNight from "@/assets/capy-bg-night.avif";

import { PRESET_LIST } from "../data/presets";
import type { DemoPreset } from "../data/presets";

const PRESET_STICKERS: Record<string, string> = {
  underwater: "/capy-broke.png",
  "paycheck-to-paycheck": "/capy-fine.png",
  "no-stress": "/capy-great.png",
};

export function DemoBudgetSelector() {
  const navigate = useNavigate();
  const { theme, resolvedTheme } = useTheme();

  const isDark = (resolvedTheme ?? theme) === "dark";
  const bgUrl = isDark ? bgNight : bgDay;

  function handleSelect(preset: DemoPreset) {
    void navigate({
      to: "/budget",
      search: { path: preset.id, name: preset.name },
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
        <ColorThemeSwitcher />
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

          {/* Preset tiles */}
          <div className="space-y-2">
            {PRESET_LIST.map((preset) => (
              <BudgetTile
                key={preset.id}
                title={preset.name}
                subtitle={preset.description}
                icon={
                  <img
                    src={PRESET_STICKERS[preset.id]}
                    alt=""
                    className="h-8 w-8 shrink-0 object-contain"
                  />
                }
                onClick={() => handleSelect(preset)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
