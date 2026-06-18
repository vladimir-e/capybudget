import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { exists } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { FolderPlus, FolderOpen, HelpCircle, AlertCircle, ExternalLink } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_CURRENCY } from "@capybudget/core";
import { useAppStore } from "@/stores/app-store";
import { CurrencyCombobox } from "@/components/budget/currency-combobox";
import {
  detectBudget,
  bootstrapBudget,
  inspectFolder,
  findMissingBudgetPaths,
} from "../../../../../src/services/budget";
import { ThemeToggle } from "@/components/theme-toggle";
import { RecentBudgetCard } from "@/components/budget/recent-budget-card";
import bgDay from "@/assets/capy-bg-day.webp";
import bgNight from "@/assets/capy-bg-night.webp";
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

  // Error modal state — shown when the user picks a folder that's non-empty
  // but doesn't contain a budget. Both intents share the dialog, copy varies.
  type Intent = "new" | "open";
  const [errorModal, setErrorModal] = useState<Intent | null>(null);

  const [createTarget, setCreateTarget] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createCurrency, setCreateCurrency] = useState(DEFAULT_CURRENCY);

  // Resolve which background to use: prefer explicit user choice, fall back
  // to system preference.
  const isDark = (resolvedTheme ?? theme) === "dark";
  const bgUrl = isDark ? bgNight : bgDay;

  // Prune dead recents on mount: any path whose budget.json is gone (folder
  // deleted, drive unmounted, etc.) gets dropped silently. Runs once.
  useEffect(() => {
    let cancelled = false;
    const paths = useAppStore.getState().recentBudgets.map((b) => b.path);
    if (paths.length === 0) return;
    void findMissingBudgetPaths(paths).then((missing) => {
      if (cancelled) return;
      const remove = useAppStore.getState().removeRecentBudget;
      for (const p of missing) remove(p);
    });
    return () => { cancelled = true; };
  }, []);

  // ── navigation helper ───────────────────────────────────────────────────────

  async function navigateToBudget(folderPath: string, name: string) {
    addRecentBudget(folderPath, name);
    await navigate({
      to: "/budget",
      search: { path: folderPath, name },
    });
  }

  // ── shared folder processor ─────────────────────────────────────────────────
  //
  // Both buttons converge here: empty folder → bootstrap, budget folder → open,
  // non-empty non-budget → error modal (with intent-flavored copy).

  async function processFolder(folderPath: string, intent: Intent) {
    setLoading(true);
    try {
      // Most often a stale recent: folder was deleted or its drive
      // unmounted. Translate the otherwise-cryptic fs error into something
      // human and quietly clean up the recent if it's there.
      if (!(await exists(folderPath))) {
        toast.error("This folder no longer exists.", {
          description: "Removed from recents.",
        });
        removeRecentBudget(folderPath);
        return;
      }

      const info = await inspectFolder(folderPath);

      if (info.hasBudget) {
        const meta = await detectBudget(folderPath);
        if (!meta) {
          // budget.json disappeared between inspect and detect — treat as failure
          toast.error("Failed to open budget");
          return;
        }
        await navigateToBudget(folderPath, meta.name);
        return;
      }

      if (info.isEmpty) {
        // Defer bootstrap to the confirm dialog so the user sets name + currency first.
        setCreateName(deriveNameFromPath(folderPath));
        setCreateCurrency(DEFAULT_CURRENCY);
        setCreateTarget(folderPath);
        return;
      }

      // Non-empty, no budget — show error modal.
      setErrorModal(intent);
    } catch (err) {
      toast.error(
        intent === "new" ? "Failed to create budget" : "Failed to open budget",
        {
          description: err instanceof Error ? err.message : String(err),
        }
      );
    } finally {
      setLoading(false);
    }
  }

  async function pickAndProcess(intent: Intent) {
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
    await processFolder(selected, intent);
  }

  function handleNewBudget() {
    void pickAndProcess("new");
  }

  function handleOpenExisting() {
    void pickAndProcess("open");
  }

  function handleRecentOpen(folderPath: string) {
    void processFolder(folderPath, "open");
  }

  function dismissErrorAndRetry() {
    const intent = errorModal;
    setErrorModal(null);
    if (intent) void pickAndProcess(intent);
  }

  async function handleCreateBudget() {
    if (!createTarget || loading) return;
    const folderPath = createTarget;
    const name = createName.trim() || deriveNameFromPath(folderPath);
    setLoading(true);
    try {
      const meta = await bootstrapBudget(folderPath, name, createCurrency);
      setCreateTarget(null);
      toast.success("New budget created");
      await navigateToBudget(folderPath, meta.name);
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
              Free, open source, with AI powers.
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
              className="h-12 w-full gap-2 text-sm dark:bg-input/50 dark:hover:bg-background/70"
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
                Capy stores everything as plain files inside a folder you
                choose &mdash; transactions.csv, budget.json. Sync across
                devices by putting it in iCloud or Google Drive.
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
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1 -mr-1">
                {recentBudgets.map((budget) => (
                  <RecentBudgetCard
                    key={budget.path}
                    budget={budget}
                    onOpen={handleRecentOpen}
                    onRemove={removeRecentBudget}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Footer — link to the marketing site. */}
          <div className="mt-6 text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              onClick={() => { void openExternal("https://capybudget.app"); }}
            >
              capybudget.app
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Folder error modal — non-empty folder with no budget. Copy reflects
          which button the user pressed; primary action re-opens the picker. */}
      <Dialog
        open={!!errorModal}
        onOpenChange={(isOpen) => { if (!isOpen) setErrorModal(null); }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
              <DialogTitle>
                {errorModal === "new"
                  ? "This folder isn’t empty"
                  : "No budget in this folder"}
              </DialogTitle>
            </div>
            <DialogDescription>
              {errorModal === "new"
                ? "Pick an empty folder to start a new budget."
                : "Pick a folder that already has a budget, or an empty folder to start a new one."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorModal(null)}>
              Cancel
            </Button>
            <Button onClick={dismissErrorAndRetry}>
              Pick another folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!createTarget}
        onOpenChange={(isOpen) => { if (!isOpen) setCreateTarget(null); }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>New budget</DialogTitle>
            <DialogDescription>Name it and pick a display currency.</DialogDescription>
          </DialogHeader>
          <form
            id="create-budget"
            onSubmit={(e) => { e.preventDefault(); void handleCreateBudget(); }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="budget-name">Name</Label>
              <Input
                id="budget-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="budget-currency">Currency</Label>
              <div>
                <CurrencyCombobox
                  id="budget-currency"
                  value={createCurrency}
                  onChange={setCreateCurrency}
                />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" form="create-budget" disabled={loading}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
