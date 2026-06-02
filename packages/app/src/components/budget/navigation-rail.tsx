import { useEffect, useMemo } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Receipt, PieChart, FileUp, Settings, BookOpen } from "lucide-react";

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
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const routes: Record<string, string> = { "1": "/budget", "2": "/budget/categories", "3": "/budget/import" };
      const to = routes[e.key];
      if (to) {
        e.preventDefault();
        navigate({ to, search });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, search]);

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
        <NavItem variant="rail" to="/budget" search={search} active={isAccounts} icon={Receipt} label="Accounts" />
        <NavItem variant="rail" to="/budget/categories" search={search} active={isBudget} icon={PieChart} label="Budget" />
        <NavItem variant="rail" to="/budget/import" search={search} active={isImport} icon={FileUp} label="Import" indicator={hasImportData} />

        {/* Bottom utility cluster — separated from primary nav.
            Sidebar collapse lives on the sidebar itself, not the rail. */}
        <div className="mt-auto flex flex-col items-center gap-1 pb-3 pt-2 border-t border-sidebar-border/40 w-full">
          <NavItem variant="rail" to="/budget/help" search={search} active={isHelp} icon={BookOpen} label="Help" />
          <NavItem variant="rail" to="/budget/settings" search={search} active={isSettings} icon={Settings} label="Settings" />
        </div>
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-center justify-around border-t border-sidebar-border bg-sidebar/95 backdrop-blur-sm px-2 pb-[env(safe-area-inset-bottom)]">
        <NavItem variant="tab" to="/budget" search={search} active={isAccounts} icon={Receipt} label="Accounts" />
        <NavItem variant="tab" to="/budget/categories" search={search} active={isBudget} icon={PieChart} label="Budget" />
        <NavItem variant="tab" to="/budget/import" search={search} active={isImport} icon={FileUp} label="Import" indicator={hasImportData} />
      </nav>
    </>
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
}: {
  variant: "rail" | "tab";
  to: string;
  search?: Record<string, string>;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  indicator?: boolean;
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
    </Link>
  );
}
