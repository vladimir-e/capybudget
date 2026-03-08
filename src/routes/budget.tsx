import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/budget/sidebar";
import { AddAccountDialog } from "@/components/budget/add-account-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from "@/lib/mock-data";

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
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/" })}
          >
            &larr; Budgets
          </Button>
          <h1 className="text-lg font-semibold">{name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-mono truncate max-w-80">
            {path}
          </span>
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
        <main className="flex-1 overflow-auto">
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
