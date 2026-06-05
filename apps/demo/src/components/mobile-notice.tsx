const PROMO_URL = "https://capybudget.app";

/**
 * Top strip shown only on small screens across every demo route. The demo
 * mirrors the desktop app's full-height layout, which isn't built for phones —
 * this points visitors to the promo site (never a direct binary download, which
 * would be useless on mobile). Sits as the first in-flow element above the app
 * shell so it durably pushes the below-banner region down (see styles.css).
 */
export function MobileNotice() {
  return (
    <div className="border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground sm:hidden">
      <span>Capy Budget is a desktop app — this preview isn't built for small screens.</span>{" "}
      <a
        href={PROMO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium whitespace-nowrap text-primary hover:underline"
      >
        Get the desktop app →
      </a>
    </div>
  );
}
