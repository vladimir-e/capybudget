import { useEffect } from "react";
import { createRootRoute } from "@tanstack/react-router";
import { RootLayout } from "@/components/root-layout";

/**
 * Block the webview's default file-drop behavior across the whole app.
 *
 * Tauri's `dragDropEnabled` is `false`, so file drops surface as HTML5
 * DOM events. If nothing calls `preventDefault()`, the webview navigates
 * to the dropped file — the user can't get back without restarting the
 * app. The import page handles drops on its own surface; everywhere
 * else, drops should silently no-op.
 *
 * Capture phase so the global guard fires before page-level handlers;
 * preventing the default on bubbling-phase handlers in the import page
 * still works because they call `preventDefault()` themselves.
 */
function StrayDropGuard() {
  useEffect(() => {
    const blockDefault = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", blockDefault, { capture: true });
    window.addEventListener("drop", blockDefault, { capture: true });
    return () => {
      window.removeEventListener("dragover", blockDefault, { capture: true });
      window.removeEventListener("drop", blockDefault, { capture: true });
    };
  }, []);
  return null;
}

function RootRouteComponent() {
  return (
    <>
      <StrayDropGuard />
      <RootLayout />
    </>
  );
}

export const Route = createRootRoute({
  component: RootRouteComponent,
});
