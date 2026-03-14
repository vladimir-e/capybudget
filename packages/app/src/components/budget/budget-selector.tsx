import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppStore } from "@/stores/app-store";
import { detectBudget, bootstrapBudget } from "../../../../../src/services/budget";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";

export function BudgetSelector() {
  const navigate = useNavigate();
  const { recentBudgets, addRecentBudget, removeRecentBudget } = useAppStore();
  const [loading, setLoading] = useState(false);

  async function openBudget(folderPath: string) {
    setLoading(true);
    try {
      let meta = await detectBudget(folderPath);
      if (!meta) {
        const folderName = folderPath.split("/").filter(Boolean).pop() ?? "My Budget";
        meta = await bootstrapBudget(folderPath, folderName);
        toast.success("New budget created");
      }
      addRecentBudget(folderPath, meta.name);
      navigate({
        to: "/budget",
        search: { path: folderPath, name: meta.name },
      });
    } catch (err) {
      toast.error("Failed to open budget", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handlePickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await openBudget(selected);
    }
  }

  function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    removeRecentBudget(path);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function shortenPath(path: string) {
    const home = path.replace(/^\/Users\/[^/]+/, "~");
    const parts = home.split("/");
    if (parts.length > 4) {
      return parts.slice(0, 2).join("/") + "/.../" + parts.slice(-2).join("/");
    }
    return home;
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <ColorThemeSwitcher />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg space-y-8 px-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Capy Budget</h1>
          <p className="text-muted-foreground">
            Pick a folder to open or create a budget
          </p>
        </div>

        <Button
          className="w-full h-12 text-base gap-2 bg-primary hover:bg-primary/90"
          onClick={handlePickFolder}
          disabled={loading}
        >
          <FolderOpen className="h-5 w-5" />
          {loading ? "Opening..." : "Open budget folder"}
        </Button>

        {recentBudgets.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
              Recent
            </h2>
            <div className="space-y-2">
              {recentBudgets.map((budget) => (
                <Card
                  key={budget.path}
                  className="cursor-pointer transition-all hover:bg-accent hover:shadow-sm py-0 border-border/70"
                  onClick={() => openBudget(budget.path)}
                >
                  <CardHeader className="flex-row items-center justify-between p-4 space-y-0">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate font-semibold">
                        {budget.name}
                      </CardTitle>
                      <CardDescription className="truncate text-xs font-mono">
                        {shortenPath(budget.path)}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <span className="text-xs text-muted-foreground/60">
                        {formatDate(budget.lastOpened)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-destructive"
                        onClick={(e) => handleRemoveRecent(e, budget.path)}
                      >
                        ×
                      </Button>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
