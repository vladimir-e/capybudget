import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Receipt, PieChart, FileUp, Settings, BookOpen } from "lucide-react";
import { useTranslation } from "@capybudget/i18n";
import { ModHintBadge } from "@/components/budget/mod-hint-badge";
import { useAnalyticsStore } from "@/stores/analytics-store";
import { modKey } from "@/lib/platform";

export type Section = "accounts" | "budget" | "import";

interface NavigationRailProps {
  budgetPath: string;
  budgetName: string;
  activeSection: Section;
  hasImportData?: boolean;
}

export function NavigationRail({
  budgetPath,
  budgetName,
  activeSection,
  hasImportData,
}: NavigationRailProps) {
  const search = useMemo(() => ({ path: budgetPath, name: budgetName }), [budgetPath, budgetName]);
  // Re-entering Budget lands on the last-viewed analytics tab. Spending is the
  // default, so omit the key there to keep URLs clean (absent === spending).
  const lastTab = useAnalyticsStore((s) => s.lastTab);
  const budgetSearch = useMemo(
    () => (lastTab === "spending" ? search : { ...search, tab: lastTab }),
    [search, lastTab],
  );
  const navigate = useNavigate();
  const { t } = useTranslation("common");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const routes: Record<string, { to: string; search: Record<string, string> }> = {
        "1": { to: "/budget", search },
        "2": { to: "/budget/categories", search: budgetSearch },
        "3": { to: "/budget/import", search },
      };
      const dest = routes[e.key];
      if (dest) {
        e.preventDefault();
        navigate(dest);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, search, budgetSearch]);

  const isAccounts = activeSection === "accounts";
  const isBudget = activeSection === "budget";
  const isImport = activeSection === "import";

  // Settings is a sibling of the budget tabs (not part of `activeSection`,
  // which is scoped to the tabs). The router path tells us when the gear
  // should highlight.
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isSettings = currentPath === "/budget/settings";
  const isHelp = currentPath === "/budget/help";

  return (
    <>
      {/* Desktop: vertical rail */}
      <nav className="hidden md:flex w-16 flex-col items-center border-r border-sidebar-border bg-sidebar pt-3 gap-1 shrink-0">
        <HistoryNav variant="rail" className="w-full justify-center border-b border-sidebar-border/40 pb-2 mb-1" />
        <NavItem variant="rail" to="/budget" search={search} active={isAccounts} icon={Receipt} label={t("nav.accounts")} hint="1" />
        <NavItem variant="rail" to="/budget/categories" search={budgetSearch} active={isBudget} icon={PieChart} label={t("nav.budget")} hint="2" />
        <NavItem variant="rail" to="/budget/import" search={search} active={isImport} icon={FileUp} label={t("nav.import")} indicator={hasImportData} hint="3" />

        {/* Bottom utility cluster — separated from primary nav.
            Sidebar collapse lives on the sidebar itself, not the rail. */}
        <div className="mt-auto flex flex-col items-center gap-1 pb-3 pt-2 border-t border-sidebar-border/40 w-full">
          <NavItem variant="rail" to="/budget/help" search={search} active={isHelp} icon={BookOpen} label={t("nav.help")} />
          <NavItem variant="rail" to="/budget/settings" search={search} active={isSettings} icon={Settings} label={t("nav.settings")} hint={`${modKey},`} />
        </div>
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-center justify-around border-t border-sidebar-border bg-sidebar/95 backdrop-blur-sm px-2 pb-[env(safe-area-inset-bottom)]">
        <HistoryNav variant="tab" />
        <NavItem variant="tab" to="/budget" search={search} active={isAccounts} icon={Receipt} label={t("nav.accounts")} />
        <NavItem variant="tab" to="/budget/categories" search={budgetSearch} active={isBudget} icon={PieChart} label={t("nav.budget")} />
        <NavItem variant="tab" to="/budget/import" search={search} active={isImport} icon={FileUp} label={t("nav.import")} indicator={hasImportData} />
      </nav>
    </>
  );
}

// ── Browser-style back/forward ────────────────────────────

// Back/forward over the router's history. `__TSR_index` is the app-relative
// position; the furthest index we've seen is the forward ceiling. We track that
// rather than read `history.length` — in the browser demo `history.length` counts
// session entries predating the SPA, so Forward would render enabled while
// `history.forward()` no-ops. Subscribing to the index re-renders on every
// push/back/forward so the disabled states stay live.
function HistoryNav({ variant, className }: { variant: "rail" | "tab"; className?: string }) {
  const router = useRouter();
  const { t } = useTranslation("common");
  const index = useRouterState({ select: (s) => s.location.state.__TSR_index ?? 0 });
  // Track the furthest index seen by adjusting state during render (React's
  // sanctioned alternative to a set-state effect).
  const [maxIndex, setMaxIndex] = useState(index);
  if (index > maxIndex) setMaxIndex(index);
  const canGoBack = index > 0;
  const canGoForward = index < maxIndex;

  const button =
    variant === "rail"
      ? "h-11 w-8 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      : "h-11 w-11 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground";

  return (
    <div className={`flex items-center gap-0.5 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => router.history.back()}
        disabled={!canGoBack}
        aria-label={t("nav.back")}
        className={`flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none ${button}`}
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => router.history.forward()}
        disabled={!canGoForward}
        aria-label={t("nav.forward")}
        className={`flex items-center justify-center transition-colors disabled:opacity-30 disabled:pointer-events-none ${button}`}
      >
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Shared nav item ───────────────────────────────────────

const variantStyles = {
  rail: {
    link: "w-12 rounded-lg px-1 py-2",
    active: "bg-sidebar-accent text-sidebar-accent-foreground",
    inactive: "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
    iconActive: "text-brand",
    label: "leading-tight",
    indicator: "top-1.5 right-1.5",
  },
  tab: {
    link: "px-4 py-2",
    active: "text-brand",
    inactive: "text-sidebar-foreground/50",
    iconActive: "",
    label: "",
    indicator: "top-1 right-2",
  },
} as const;

function NavItem({
  variant,
  to,
  search,
  active,
  icon: Icon,
  label,
  indicator,
  hint,
}: {
  variant: "rail" | "tab";
  to: string;
  search?: Record<string, string>;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  indicator?: boolean;
  hint?: string;
}) {
  const s = variantStyles[variant];
  return (
    <Link
      to={to}
      search={search}
      className={`relative flex flex-col items-center gap-0.5 transition-colors ${s.link} ${active ? s.active : s.inactive}`}
      aria-current={active ? "page" : undefined}
    >
      <Icon className={`h-5 w-5 ${active ? s.iconActive : ""}`} />
      <span className={`text-[10px] font-medium ${s.label}`}>{label}</span>
      {indicator && (
        <span className={`absolute flex h-2 w-2 rounded-full bg-brand animate-pulse ${s.indicator}`} />
      )}
      {hint && <ModHintBadge className="left-1/2 top-1 -translate-x-1/2">{hint}</ModHintBadge>}
    </Link>
  );
}
