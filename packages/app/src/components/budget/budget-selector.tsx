import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { FolderPlus, FolderOpen, HelpCircle, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/stores/app-store";
import {
  detectBudget,
  bootstrapBudget,
  inspectFolder,
} from "../../../../../src/services/budget";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { RecentBudgetCard } from "@/components/budget/recent-budget-card";
import bgDay from "@/assets/capy-bg-day.avif";
import bgNight from "@/assets/capy-bg-night.avif";
import { useTheme } from "next-themes";

// ── helpers ──────────────────────────────────────────────────────────────────

function deriveNameFromPath(folderPath: string): string {
  return folderPath.split("/").filter(Boolean).pop() ?? "My Budget";
}

// ── component ─────────────────────────────────────────────────────────────────

export function BudgetSelector() {
  const navigate = useNavigate();
  const { theme, resolvedTheme } = useTheme();
  const { recentBudgets, addRecentBudget, removeRecentBudget } = useAppStore();
  const [loading, setLoading] = useState(false);

  // Non-empty-folder confirmation dialog state
  const [pendingFolder, setPendingFolder] = useState<{
    path: string;
    itemCount: number;
  } | null>(null);

  // Resolve which background to use: prefer explicit user choice, fall back
  // to system preference.
  const isDark = (resolvedTheme ?? theme) === "dark";
  const bgUrl = isDark ? bgNight : bgDay;

  // ── navigation helper ───────────────────────────────────────────────────────

  async function navigateToBudget(folderPath: string, name: string) {
    addRecentBudget(folderPath, name);
    await navigate({
      to: "/budget",
      search: { path: folderPath, name },
    });
  }

  // ── open existing flow ──────────────────────────────────────────────────────

  async function openExistingAt(folderPath: string) {
    setLoading(true);
    try {
      const meta = await detectBudget(folderPath);
      if (!meta) {
        // No budget here — offer to flip into new flow.
        toast.error("This folder doesn't contain a budget.", {
          action: {
            label: "Create here instead",
            onClick: () => runNewFlow(folderPath),
          },
        });
        return;
      }
      await navigateToBudget(folderPath, meta.name);
    } catch (err) {
      toast.error("Failed to open budget", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenExisting() {
    if (loading) return;
    setLoading(true);
    let selected: string | null = null;
    try {
      selected = (await open({ directory: true, multiple: false })) as
        | string
        | null;
    } finally {
      setLoading(false);
    }
    if (!selected) return;
    await openExistingAt(selected);
  }

  // ── new budget flow ─────────────────────────────────────────────────────────

  async function handleNewBudget() {
    if (loading) return;
    setLoading(true);
    let selected: string | null = null;
    try {
      selected = (await open({ directory: true, multiple: false })) as
        | string
        | null;
    } finally {
      setLoading(false);
    }
    if (!selected) return;
    await runNewFlow(selected);
  }

  async function runNewFlow(folderPath: string) {
    setLoading(true);
    try {
      const info = await inspectFolder(folderPath);

      if (info.hasBudget) {
        toast.error("This folder is already a budget. Use Open existing.");
        return;
      }

      if (!info.isEmpty) {
        // Ask for confirmation before bootstrapping into a non-empty folder.
        setPendingFolder({ path: folderPath, itemCount: info.itemCount });
        return;
      }

      await doBootstrap(folderPath);
    } catch (err) {
      toast.error("Failed to create budget", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  async function doBootstrap(folderPath: string) {
    const name = deriveNameFromPath(folderPath);
    const meta = await bootstrapBudget(folderPath, name);
    toast.success("New budget created");
    await navigateToBudget(folderPath, meta.name);
  }

  async function confirmNonEmptyCreate() {
    if (!pendingFolder) return;
    const { path } = pendingFolder;
    setPendingFolder(null);
    setLoading(true);
    try {
      await doBootstrap(path);
    } catch (err) {
      toast.error("Failed to create budget", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Full-bleed background */}
      <div
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgUrl})` }}
        aria-hidden
      />

      {/* Top-right controls */}
      <div className="fixed top-4 right-4 z-10 flex items-center gap-1">
        <ColorThemeSwitcher />
        <ThemeToggle />
      </div>

      {/* Centered glass card */}
      <div className="relative z-0 flex h-screen items-center justify-center px-4">
        <div
          className="w-full max-w-md rounded-2xl border border-border/40 bg-card/85 p-8 shadow-overlay backdrop-blur-md dark:bg-card/70"
        >
          {/* Eyebrow + title + subtitle */}
          <div className="space-y-1 mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 font-mono">
              Welcome
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Capy Budget
            </h1>
            <p className="text-sm text-muted-foreground">
              Create a budget or open an existing one.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-3">
            <Button
              className="h-12 w-full gap-2 text-sm"
              onClick={handleNewBudget}
              disabled={loading}
            >
              <FolderPlus className="h-5 w-5" />
              New budget
            </Button>

            <Button
              variant="outline"
              className="h-12 w-full gap-2 text-sm"
              onClick={handleOpenExisting}
              disabled={loading}
            >
              <FolderOpen className="h-5 w-5" />
              Open existing&hellip;
            </Button>
          </div>

          {/* Help popover */}
          <div className="mt-5">
            <Popover>
              <PopoverTrigger className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground hover:underline underline-offset-2 transition-colors cursor-default">
                <HelpCircle className="h-3.5 w-3.5 shrink-0" />
                What&rsquo;s a budget folder?
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start" className="w-80 text-sm leading-relaxed text-muted-foreground">
                A budget folder holds your CSV files (accounts, transactions,
                categories) and a small <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">budget.json</code> index.
                Pick any folder you back up — iCloud, Dropbox, a local drive —
                and Capy keeps everything in plain text inside it.
              </PopoverContent>
            </Popover>
          </div>

          {/* Recent budgets */}
          {recentBudgets.length > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border/50" />
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 font-mono">
                  Recent
                </p>
                <div className="h-px flex-1 bg-border/50" />
              </div>
              <div className="space-y-2">
                {recentBudgets.map((budget) => (
                  <RecentBudgetCard
                    key={budget.path}
                    budget={budget}
                    onOpen={openExistingAt}
                    onRemove={removeRecentBudget}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Non-empty folder confirmation dialog */}
      <Dialog
        open={!!pendingFolder}
        onOpenChange={(isOpen) => { if (!isOpen) setPendingFolder(null); }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <File className="h-5 w-5 text-muted-foreground" />
              <DialogTitle>This folder isn&rsquo;t empty</DialogTitle>
            </div>
            <DialogDescription>
              This folder contains {pendingFolder?.itemCount ?? 0} item
              {(pendingFolder?.itemCount ?? 0) !== 1 ? "s" : ""}.
              Create a budget here anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingFolder(null)}>
              Cancel
            </Button>
            <Button onClick={confirmNonEmptyCreate}>
              Create budget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
