import { Sparkles } from "lucide-react";
import { useTranslation } from "@capybudget/i18n";

const PROMO_URL = "https://capybudget.app";

/**
 * Shown in place of the real ImportScreen on the demo's Import tab. Smart Import
 * needs the desktop filesystem and the intelligence layer, neither of which the
 * browser demo has — so the tab points visitors at the desktop app instead of
 * a non-functional preview.
 */
export function ImportNotice() {
  const { t } = useTranslation("demo");
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-brand/30 bg-brand/5 px-6 py-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10">
          <Sparkles className="h-5 w-5 text-brand" />
        </div>
        <div className="space-y-1.5">
          <p className="text-base font-medium">{t("importNotice.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("importNotice.body")}
          </p>
        </div>
        <a
          href={PROMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium whitespace-nowrap text-primary hover:underline"
        >
          {t("importNotice.cta")} →
        </a>
      </div>
    </div>
  );
}
