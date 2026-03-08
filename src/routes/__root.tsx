import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { useDarkMode } from "@/hooks/use-dark-mode";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useDarkMode();

  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
