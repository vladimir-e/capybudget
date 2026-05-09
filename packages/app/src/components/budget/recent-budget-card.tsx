import { FileText, X } from "lucide-react";
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
    <div
      role="button"
      tabIndex={0}
      className="group flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => onOpen(budget.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(budget.path);
        }
      }}
    >
      {/* Icon */}
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />

      {/* Name + path */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">
          {budget.name}
        </p>
        <p className="truncate text-xs font-mono text-muted-foreground/60 leading-tight mt-0.5">
          {shortenPath(budget.path)}
        </p>
      </div>

      {/* Date */}
      <span className="shrink-0 text-xs text-muted-foreground/50">
        {formatDate(budget.lastOpened)}
      </span>

      {/* Remove — 44×44 hit area, visual X subtle by default and surfaces on hover/focus */}
      <button
        type="button"
        aria-label={`Remove ${budget.name} from recents`}
        className="shrink-0 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground/30 opacity-60 transition-opacity hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(budget.path);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
