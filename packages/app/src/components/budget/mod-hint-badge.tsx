import { cn } from "@/lib/utils";
import { useModHint } from "@/contexts/mod-hint-context";

interface ModHintBadgeProps {
  /** Chord label, e.g. `${modKey}1` or `${modKey}I`. */
  children: React.ReactNode;
  /** Positioning classes for the absolute chip (placement is the caller's call). */
  className?: string;
}

/**
 * Decorative keyboard-shortcut chip that fades in while the modifier is held.
 * Absolutely positioned so it never reflows its neighbours; the real a11y is
 * the host element's `aria-label`.
 */
export function ModHintBadge({ children, className }: ModHintBadgeProps) {
  const revealed = useModHint();
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium font-mono leading-none text-background shadow-sm",
        "opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
        revealed && "opacity-100",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
