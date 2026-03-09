import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/budget/sidebar";
import { AddAccountDialog } from "@/components/budget/add-account-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { ChevronLeft } from "lucide-react";

interface BudgetSearch {
  path: string;
  name: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "Budget",
  }),
  component: BudgetLayout,
});

function BudgetLayout() {
  const { path, name } = Route.useSearch();
  const navigate = useNavigate();
  const [addAccountOpen, setAddAccountOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => navigate({ to: "/" })}
          >
            <ChevronLeft className="h-4 w-4" />
            Budgets
          </Button>
          <span className="text-border mx-1">/</span>
          <h1 className="text-sm font-semibold">{name}</h1>
        </div>
        <div className="flex items-center gap-1">
          <ColorThemeSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          accounts={MOCK_ACCOUNTS}
          transactions={MOCK_TRANSACTIONS}
          budgetPath={path}
          budgetName={name}
          onAddAccount={() => setAddAccountOpen(true)}
        />
        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>

      <AddAccountDialog
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
      />
    </div>
  );
}
