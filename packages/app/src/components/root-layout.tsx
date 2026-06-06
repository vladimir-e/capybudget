import { Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { ColorThemeProvider } from "@/components/color-theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { useStrayDropGuard } from "@/hooks/use-stray-drop-guard";

export function RootLayout() {
  useStrayDropGuard();

  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      <ColorThemeProvider>
        <Outlet />
        <Toaster />
      </ColorThemeProvider>
    </ThemeProvider>
  );
}
