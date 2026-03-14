import { createContext, useContext } from "react";
import type { ColorTheme } from "@/lib/color-themes";

export interface ColorThemeContextValue {
  colorTheme: ColorTheme;
  setColorTheme: (theme: ColorTheme) => void;
}

export const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

export function useColorTheme() {
  const ctx = useContext(ColorThemeContext);
  if (!ctx) throw new Error("useColorTheme must be used within ColorThemeProvider");
  return ctx;
}
