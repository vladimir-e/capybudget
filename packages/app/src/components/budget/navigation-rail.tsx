import { Link } from "@tanstack/react-router";
import { Receipt, PieChart, FileUp } from "lucide-react";
import { useImportStore } from "@/stores/import-store";
import type { MouseEvent } from "react";

export type Section = "accounts" | "budget" | "import";

interface NavigationRailProps {
  budgetPath: string;
  budgetName: string;
  activeSection: Section;
  onAccountsClick?: () => void;
}

export function NavigationRail({
  budgetPath,
  budgetName,
  activeSection,
  onAccountsClick,
}: NavigationRailProps) {
  const hasImportData = useImportStore((s) => s.hasImportData);
  const search = { path: budgetPath, name: budgetName };

  function handleAccountsClick(e: MouseEvent) {
    if (activeSection === "accounts" && onAccountsClick) {
      e.preventDefault();
      onAccountsClick();
    }
  }

  const isAccounts = activeSection === "accounts";
  const isBudget = activeSection === "budget";
  const isImport = activeSection === "import";

  return (
    <>
      {/* Desktop: vertical rail */}
      <nav className="hidden md:flex w-16 flex-col items-center border-r border-sidebar-border bg-sidebar pt-3 gap-1 shrink-0">
        <RailLink
          to="/budget"
          search={search}
          active={isAccounts}
          icon={Receipt}
          label="Accounts"
          onClick={handleAccountsClick}
        />
        <RailLink
          to="/budget/categories"
          search={search}
          active={isBudget}
          icon={PieChart}
          label="Budget"
        />
        <RailLink
          to="/budget/import"
          search={search}
          active={isImport}
          icon={FileUp}
          label="Import"
          indicator={hasImportData}
        />
      </nav>

      {/* Mobile: bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-center justify-around border-t border-sidebar-border bg-sidebar/95 backdrop-blur-sm px-2 pb-[env(safe-area-inset-bottom)]">
        <TabLink
          to="/budget"
          search={search}
          active={isAccounts}
          icon={Receipt}
          label="Accounts"
          onClick={handleAccountsClick}
        />
        <TabLink
          to="/budget/categories"
          search={search}
          active={isBudget}
          icon={PieChart}
          label="Budget"
        />
        <TabLink
          to="/budget/import"
          search={search}
          active={isImport}
          icon={FileUp}
          label="Import"
          indicator={hasImportData}
        />
      </nav>
    </>
  );
}

// ── Desktop rail item ─────────────────────────────────────

function RailLink({
  to,
  search,
  active,
  icon: Icon,
  label,
  onClick,
  indicator,
}: {
  to: string;
  search: Record<string, string>;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: (e: MouseEvent) => void;
  indicator?: boolean;
}) {
  return (
    <Link
      to={to}
      search={search}
      onClick={onClick}
      className={`relative flex w-12 flex-col items-center gap-0.5 rounded-lg px-1 py-2 transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Icon className={`h-5 w-5 ${active ? "text-brand" : ""}`} />
      <span className="text-[10px] font-medium leading-tight">{label}</span>
      {indicator && (
        <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-brand animate-pulse" />
      )}
    </Link>
  );
}

// ── Mobile tab item ───────────────────────────────────────

function TabLink({
  to,
  search,
  active,
  icon: Icon,
  label,
  indicator,
  onClick,
}: {
  to: string;
  search: Record<string, string>;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  indicator?: boolean;
  onClick?: (e: MouseEvent) => void;
}) {
  return (
    <Link
      to={to}
      search={search}
      onClick={onClick}
      className={`relative flex flex-col items-center gap-0.5 px-4 py-2 transition-colors ${
        active
          ? "text-brand"
          : "text-sidebar-foreground/50"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[10px] font-medium">{label}</span>
      {indicator && (
        <span className="absolute top-1 right-2 flex h-2 w-2 rounded-full bg-brand animate-pulse" />
      )}
    </Link>
  );
}
