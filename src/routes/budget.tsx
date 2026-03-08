import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

interface BudgetSearch {
  path: string;
  name: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "Budget",
  }),
  component: BudgetView,
});

function BudgetView() {
  const { path, name } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
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
        <span className="text-muted-foreground text-xs font-mono truncate max-w-80">
          {path}
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl">🏗️</div>
          <h2 className="text-2xl font-semibold">Budget workspace</h2>
          <p className="text-muted-foreground max-w-md">
            Accounts, transactions, and categories will live here.
            <br />
            This area is ready for the budget management UI.
          </p>
        </div>
      </main>
    </div>
  );
}
