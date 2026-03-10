import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useColorTheme } from "@/components/color-theme-provider";
import { COLOR_THEMES, type ColorTheme } from "@/lib/color-themes";

const entries = Object.entries(COLOR_THEMES) as [
  ColorTheme,
  (typeof COLOR_THEMES)[ColorTheme],
][];

export function ColorThemeSwitcher() {
  const { colorTheme, setColorTheme } = useColorTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Color theme" />
        }
      >
        <Palette className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={colorTheme}
          onValueChange={(v) => setColorTheme(v as ColorTheme)}
        >
          {entries.map(([key, { label, swatch }]) => (
            <DropdownMenuRadioItem key={key} value={key}>
              <span
                className="inline-block h-3 w-3 rounded-full border border-foreground/15"
                style={{ background: swatch }}
              />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
