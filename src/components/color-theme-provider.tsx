import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type ColorTheme,
  DEFAULT_COLOR_THEME,
  COLOR_THEME_STORAGE_KEY,
} from "@/lib/color-themes";

interface ColorThemeContext {
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
}

const Ctx = createContext<ColorThemeContext | null>(null);

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
    <Ctx.Provider value={{ colorTheme, setColorTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useColorTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useColorTheme must be used within ColorThemeProvider");
  return ctx;
}
