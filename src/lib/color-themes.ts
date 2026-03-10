export const COLOR_THEMES = {
  capybara: { label: "Capybara", swatch: "oklch(0.58 0.14 55)" },
  ocean: { label: "Ocean", swatch: "oklch(0.55 0.14 240)" },
  forest: { label: "Forest", swatch: "oklch(0.52 0.14 152)" },
  rose: { label: "Rose", swatch: "oklch(0.58 0.14 350)" },
  slate: { label: "Slate", swatch: "oklch(0.50 0.03 260)" },
} as const;

export type ColorTheme = keyof typeof COLOR_THEMES;

export const DEFAULT_COLOR_THEME: ColorTheme = "capybara";
export const COLOR_THEME_STORAGE_KEY = "color-theme";
