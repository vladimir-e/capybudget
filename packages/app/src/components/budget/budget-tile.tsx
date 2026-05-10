import { FileText, X } from "lucide-react";
import type { ReactNode } from "react";

interface BudgetTileProps {
  title: string;
  subtitle: ReactNode;
  trailing?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}

export function BudgetTile({
  title,
  subtitle,
  trailing,
  icon,
  onClick,
  onRemove,
  removeLabel,
}: BudgetTileProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="group flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {icon ?? (
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        <div className="truncate text-xs text-muted-foreground/60 leading-tight mt-0.5">
          {subtitle}
        </div>
      </div>

      {trailing && (
        <span className="shrink-0 text-xs text-muted-foreground/50">
          {trailing}
        </span>
      )}

      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? "Remove"}
          className="shrink-0 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground/30 opacity-60 transition-opacity hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
