import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Optional icon — rendered muted and oversized. Omit for a calm, text-only state. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional CTA. `action` and `children` are interchangeable slots. */
  action?: ReactNode;
  children?: ReactNode;
  /** Tune vertical breathing room; defaults to `py-12`. */
  className?: string;
}

/** Shared empty-state: centered, muted, with optional icon, description, and CTA slot. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  className,
}: EmptyStateProps) {
  const cta = action ?? children;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center text-muted-foreground",
        className,
      )}
    >
      {icon && <div className="mb-3 opacity-30 [&>svg]:h-12 [&>svg]:w-12">{icon}</div>}
      <p className="text-base font-medium text-foreground/90">{title}</p>
      {description && <p className="mt-1 text-sm opacity-70">{description}</p>}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
