import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system">
      <Outlet />
      <Toaster />
    </ThemeProvider>
  );
}
