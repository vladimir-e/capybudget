import { useNavigate } from "@tanstack/react-router";
import { TrendingDown, Clock, Sparkles } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { PRESET_LIST } from "../data/presets";
import type { DemoPreset } from "../data/presets";

const PRESET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  underwater: TrendingDown,
  "paycheck-to-paycheck": Clock,
  "no-stress": Sparkles,
};

export function DemoBudgetSelector() {
  const navigate = useNavigate();

  function handleSelect(preset: DemoPreset) {
    navigate({
      to: "/budget",
      search: { path: preset.id, name: preset.name },
    });
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <ColorThemeSwitcher />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-3xl space-y-8 px-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Capy Budget</h1>
          <p className="text-muted-foreground">
            Select a budget to explore
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PRESET_LIST.map((preset) => {
            const Icon = PRESET_ICONS[preset.id];
            return (
              <Card
                key={preset.id}
                className="cursor-pointer transition-all hover:bg-accent hover:shadow-md py-0"
                onClick={() => handleSelect(preset)}
              >
                <CardHeader className="items-center text-center p-6 space-y-3">
                  {Icon && <Icon className="h-8 w-8 text-primary self-center" />}
                  <CardTitle className="text-lg">{preset.name}</CardTitle>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
