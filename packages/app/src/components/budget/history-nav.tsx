import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "@capybudget/i18n";
import { Button } from "@/components/ui/button";

// Browser-style back/forward over the router's history. The forward ceiling is
// the live history length — reliable because this control is desktop-only, so
// the Tauri webview holds only in-app entries (no pre-SPA pollution) and the
// length self-corrects when a branch navigation truncates the forward stack.
export function HistoryNav({ className }: { className?: string }) {
  const router = useRouter();
  const { t } = useTranslation("common");
  const index = useRouterState({ select: (s) => s.location.state.__TSR_index ?? 0 });
  const canGoBack = index > 0;
  const canGoForward = index < router.history.length - 1;

  return (
    <div className={`flex items-center gap-0.5 ${className ?? ""}`}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={() => router.history.back()}
        disabled={!canGoBack}
        aria-label={t("nav.back")}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        onClick={() => router.history.forward()}
        disabled={!canGoForward}
        aria-label={t("nav.forward")}
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
