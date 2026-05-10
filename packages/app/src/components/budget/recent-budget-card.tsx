import type { RecentBudget } from "@capybudget/core";
import { BudgetTile } from "@/components/budget/budget-tile";

interface RecentBudgetCardProps {
  budget: RecentBudget;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
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
  return (
    <BudgetTile
      title={budget.name}
      subtitle={
        <span className="font-mono">{shortenPath(budget.path)}</span>
      }
      trailing={formatDate(budget.lastOpened)}
      onClick={() => onOpen(budget.path)}
      onRemove={() => onRemove(budget.path)}
      removeLabel={`Remove ${budget.name} from recents`}
    />
  );
}
