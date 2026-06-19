import { Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { I18nProvider } from "@capybudget/i18n";
import { ColorThemeProvider } from "@/components/color-theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { useStrayDropGuard } from "@/hooks/use-stray-drop-guard";

export function RootLayout() {
  useStrayDropGuard();

  return (
    <I18nProvider>
      <ThemeProvider attribute="class" defaultTheme="system">
        <ColorThemeProvider>
          <Outlet />
          <Toaster />
        </ColorThemeProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
