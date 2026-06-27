import { useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useTranslation } from "@capybudget/i18n";
import { Button } from "@/components/ui/button";

// Browser-style back/forward over the router's history. `__TSR_index` is the
// app-relative position; the furthest index we've seen is the forward ceiling.
// We track that rather than read `history.length` — in the browser demo
// `history.length` counts session entries predating the SPA, so Forward would
// render enabled while `history.forward()` no-ops.
export function HistoryNav({ className }: { className?: string }) {
  const router = useRouter();
  const { t } = useTranslation("common");
  const index = useRouterState({ select: (s) => s.location.state.__TSR_index ?? 0 });
  const [maxIndex, setMaxIndex] = useState(index);
  if (index > maxIndex) setMaxIndex(index);
  const canGoBack = index > 0;
  const canGoForward = index < maxIndex;

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
