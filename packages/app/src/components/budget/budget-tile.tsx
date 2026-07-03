import { FileText, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "@capybudget/i18n";

interface BudgetTileProps {
  title: string;
  subtitle: ReactNode;
  trailing?: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  /** Accessible name for the open action. Falls back to the tile's text. */
  openLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
}

export function BudgetTile({
  title,
  subtitle,
  trailing,
  icon,
  onClick,
  openLabel,
  onRemove,
  removeLabel,
}: BudgetTileProps) {
  const { t } = useTranslation("common");
  // Open and Remove are sibling buttons, never nested: a control inside a
  // control is invalid and collapses in the accessibility tree, which left the
  // row openable only as "Remove" for AX/keyboard users.
  return (
    <div className="group relative flex items-center rounded-lg border border-border/40 bg-background/40 transition-colors hover:bg-accent/60 dark:hover:bg-background/70">
      <button
        type="button"
        aria-label={openLabel}
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {icon ?? (
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground/60 leading-tight">
            {subtitle}
          </span>
        </span>

        {trailing && (
          <span className="shrink-0 text-xs text-muted-foreground/50">
            {trailing}
          </span>
        )}
      </button>

      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? t("actions.remove")}
          className="mr-1.5 shrink-0 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground/30 opacity-60 transition-opacity hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
