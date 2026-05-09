import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { RecentBudget } from "@capybudget/core";

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
    <Card
      className="cursor-pointer transition-all hover:bg-accent hover:shadow-card py-0 border-border/70"
      onClick={() => onOpen(budget.path)}
    >
      <CardHeader className="flex-row items-center justify-between p-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base truncate font-semibold">
            {budget.name}
          </CardTitle>
          <CardDescription className="truncate text-xs font-mono">
            {shortenPath(budget.path)}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span className="text-xs text-muted-foreground/60">
            {formatDate(budget.lastOpened)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(budget.path);
            }}
          >
            ×
          </Button>
        </div>
      </CardHeader>
    </Card>
  );
}
