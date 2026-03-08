import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

const CYCLE = ["light", "dark", "system"] as const;

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

const LABELS = {
  light: "Light mode",
  dark: "Dark mode",
  system: "System theme",
} as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = (theme ?? "system") as (typeof CYCLE)[number];
  const Icon = ICONS[current] ?? Monitor;
  const label = LABELS[current] ?? "System theme";

  const next = () => {
    const idx = CYCLE.indexOf(current);
    setTheme(CYCLE[(idx + 1) % CYCLE.length]);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={next}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
