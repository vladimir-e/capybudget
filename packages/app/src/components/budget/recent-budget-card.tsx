import type { RecentBudget } from "@capybudget/core";
import { useFormatLocale, useTranslation } from "@capybudget/i18n";
import { BudgetTile } from "@/components/budget/budget-tile";

interface RecentBudgetCardProps {
  budget: RecentBudget;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function shortenPath(path: string) {
  const home = path.replace(/^\/Users\/[^/]+/, "~");
  const parts = home.split("/");
  if (parts.length > 4) {
    return parts.slice(0, 2).join("/") + "/.../" + parts.slice(-2).join("/");
  }
  return home;
}

export function RecentBudgetCard({
  budget,
  onOpen,
  onRemove,
}: RecentBudgetCardProps) {
  const { t } = useTranslation("budget");
  const locale = useFormatLocale();
  return (
    <BudgetTile
      title={budget.name}
      subtitle={
        <span className="font-mono">{shortenPath(budget.path)}</span>
      }
      trailing={formatDate(budget.lastOpened, locale)}
      onClick={() => onOpen(budget.path)}
      openLabel={t("selector.openRecent", { name: budget.name })}
      onRemove={() => onRemove(budget.path)}
      removeLabel={t("selector.removeFromRecents", { name: budget.name })}
    />
  );
}
