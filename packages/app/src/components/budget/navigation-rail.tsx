import { useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Receipt, PieChart, FileUp, PanelLeftClose, PanelLeftOpen } from "lucide-react";

export type Section = "accounts" | "budget" | "import";

interface NavigationRailProps {
  budgetPath: string;
  budgetName: string;
  activeSection: Section;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  hasImportData?: boolean;
}

export function NavigationRail({
  budgetPath,
  budgetName,
  activeSection,
  sidebarOpen,
  onToggleSidebar,
  hasImportData,
}: NavigationRailProps) {
  const search = { path: budgetPath, name: budgetName };
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

  return (
    <>
      {/* Desktop: vertical rail */}
      <nav className="hidden md:flex w-16 flex-col items-center border-r border-sidebar-border bg-sidebar pt-3 gap-1 shrink-0">
        <NavItem variant="rail" to="/budget" search={search} active={isAccounts} icon={Receipt} label="Accounts" />
        <NavItem variant="rail" to="/budget/categories" search={search} active={isBudget} icon={PieChart} label="Budget" />
        <NavItem variant="rail" to="/budget/import" search={search} active={isImport} icon={FileUp} label="Import" indicator={hasImportData} />

        {/* Sidebar toggle — pushed to bottom */}
        {isAccounts && (
          <div className="mt-auto pb-3">
            <button
              type="button"
              onClick={onToggleSidebar}
              className="flex w-10 h-10 items-center justify-center rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
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
  search: Record<string, string>;
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
