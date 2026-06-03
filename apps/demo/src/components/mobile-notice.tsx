const PROMO_URL = "https://capybudget.app";

/**
 * Slim top strip shown only on small screens across every demo route. The demo
 * mirrors the desktop app's full-height layout, which isn't built for phones —
 * this points visitors to the promo site (never a direct binary download, which
 * would be useless on mobile). Mounted in a fixed-position sibling root so it
 * sits above the app shell without participating in its flex flow.
 */
export function MobileNotice() {
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex h-8 items-center justify-between gap-3 border-b border-border bg-muted px-3 text-xs text-muted-foreground sm:hidden">
      <span className="min-w-0 truncate">Capy Budget is a desktop app — this preview isn't built for small screens.</span>
      <a
        href={PROMO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 font-medium whitespace-nowrap text-primary hover:underline"
      >
        Get the desktop app →
      </a>
    </div>
  );
}
