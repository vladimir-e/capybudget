import { useCallback, useEffect, useState } from "react";
import {
  type ColorTheme,
  DEFAULT_COLOR_THEME,
  COLOR_THEME_STORAGE_KEY,
} from "@/lib/color-themes";
import { ColorThemeContext } from "@/contexts/color-theme-context";

function getStoredTheme(): ColorTheme {
  try {
    const stored = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    if (stored) return stored as ColorTheme;
  } catch {
    // SSR or storage unavailable
  }
  return DEFAULT_COLOR_THEME;
}

export function ColorThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(getStoredTheme);

  const setColorTheme = useCallback((theme: ColorTheme) => {
    setColorThemeState(theme);
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, []);

  // Apply on mount and when theme changes
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", colorTheme);
  }, [colorTheme]);

  return (
    <ColorThemeContext.Provider value={{ colorTheme, setColorTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
}
