import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useMatches, useNavigate, useSearch } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { NavigationRail, type Section } from "@/components/budget/navigation-rail";
import { Sidebar } from "@/components/budget/sidebar";

import { AccountDialog } from "@/components/budget/account-dialog";
import { TransactionForm } from "@/components/budget/transaction-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { CapyButton } from "@/components/capy/capy-button";
import { CapyOverlay } from "@/components/capy/capy-overlay/capy-overlay";
import { ModHintProvider } from "@/components/budget/mod-hint-provider";
import { ModHintBadge } from "@/components/budget/mod-hint-badge";
import { BudgetUIProvider, type BudgetUIContextValue } from "@/contexts/budget-context";
import { useCapySessionContext } from "@/contexts/capy-session-context";
import {
  useCreateTransaction,
  useUpdateTransaction,
} from "@/hooks/use-transaction-mutations";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useReorderAccounts } from "@/hooks/use-account-mutations";
import { useAccounts } from "@/hooks/use-budget-data";
import { useStartupUpdateCheck } from "@/hooks/use-startup-update-check";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { useCustomCommands } from "@/hooks/use-custom-commands";
import { useImportStore } from "@/stores/import-store";
import { useBudgetMeta } from "@/hooks/use-budget-meta";
import { modKey } from "@/lib/platform";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FolderOpen, Github, LogOut } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { Account, Transaction, TransactionFormData } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { toast } from "sonner";

declare const __IS_DEMO__: boolean;

function shortenPath(path: string, maxLen: number): string {
  const shortened = path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  if (shortened.length <= maxLen) return shortened;
  const keep = maxLen - 1;
  const tail = Math.ceil(keep / 2);
  const head = keep - tail;
  return shortened.slice(0, head) + "…" + shortened.slice(-tail);
}

export function BudgetShell() {
  const { t } = useTranslation(["budget", "common"]);
  const { path, name: searchName } = useSearch({ from: "/budget" });
  const { data: meta } = useBudgetMeta(path);
  // Live name from budget.json so a rename re-renders the header and threads the
  // fresh name into nav links; the search param is the load-time fallback.
  const name = meta.name || searchName;
  const navigate = useNavigate();
  const createTxn = useCreateTransaction();
  const updateTxn = useUpdateTransaction();
  const { undo, redo } = useUndoRedo();
  const reorderAccounts = useReorderAccounts();
  const { data: accounts = [] } = useAccounts();
  const hasAccounts = accounts.some((a) => !a.archived);

  useStartupUpdateCheck({ path, name, navigate });

  // Determine active section from current route
  const matches = useMatches();
  const activeSection: Section = matches.some((m) => m.routeId?.includes("/categories"))
    ? "budget"
    : matches.some((m) => m.routeId?.includes("/import"))
      ? "import"
      : "accounts";

  const hasImportData = useImportStore((s) => s.hasImportData);
  const isImportBusy = useImportStore((s) => s.running);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | undefined>();

  const customInstructions = useCustomInstructions(path);
  const customCommands = useCustomCommands(path);

  const { open: capyOpen, setOpen: setCapyOpen } = useCapySessionContext();

  const currentAccount = accounts.find((a) => a.id === currentAccountId);
  const isArchivedView = currentAccount?.archived === true;
  const amountRef = useRef<HTMLInputElement>(null);
  const formPanelRef = useRef<HTMLDivElement>(null);
  const formKey = editingTxn?.id ?? "new";

  const toggleForm = useCallback(() => {
    if (isArchivedView) return;
    if (!hasAccounts) {
      setAccountDialogOpen(true);
      return;
    }
    setFormOpen((prev) => {
      if (prev) setEditingTxn(null);
      return !prev;
    });
  }, [hasAccounts, isArchivedView]);

  const openTransactionForm = useCallback(() => {
    if (isArchivedView) return;
    if (!hasAccounts) {
      setAccountDialogOpen(true);
      return;
    }
    setEditingTxn(null);
    setFormOpen(true);
  }, [hasAccounts, isArchivedView]);

  const handleDismissForm = useCallback(() => {
    setFormOpen(false);
    setEditingTxn(null);
  }, []);

  // Suppress form when viewing an archived account
  const effectiveFormOpen = formOpen && !isArchivedView;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "n") {
        e.preventDefault();
        toggleForm();
      }
      if (mod && e.key === "i") {
        e.preventDefault();
        setCapyOpen((prev) => !prev);
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        navigate({ to: "/budget/settings", search: { path, name } });
      }
      if (e.key === "Escape" && capyOpen) {
        e.preventDefault();
        setCapyOpen(false);
        return;
      }
      if (e.key === "Escape" && effectiveFormOpen && !formPanelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        handleDismissForm();
        return;
      }
      if (mod && e.key === "z") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleForm, undo, redo, effectiveFormOpen, handleDismissForm, capyOpen, setCapyOpen, navigate, path, name]);

  useEffect(() => {
    if (effectiveFormOpen) {
      const timer = setTimeout(() => amountRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [effectiveFormOpen, formKey]);

  const handleReorderAccounts = useCallback(
    (type: import("@capybudget/core").AccountType, orderedIds: string[]) => {
      reorderAccounts.mutate({ type, orderedIds });
    },
    [reorderAccounts],
  );

  const handleSave = useCallback((data: TransactionFormData) => {
    if (data.id) {
      updateTxn.mutate(data);
      setEditingTxn(null);
      setFormOpen(false);
      toast.success(t("transaction.toast.updated"));
    } else {
      createTxn.mutate(data);
      setFormOpen(false);
      toast.success(t("transaction.toast.added"));
    }
  }, [createTxn, updateTxn, t]);

  const editTransaction = useCallback((txn: Transaction) => {
    setEditingTxn(txn);
    setFormOpen(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingTxn(null);
    setFormOpen(false);
  }, []);

  const openAccountDialog = useCallback(() => setAccountDialogOpen(true), []);

  const uiCtx = useMemo<BudgetUIContextValue>(() => ({
    editingTxnId: editingTxn?.id,
    editTransaction,
    cancelEdit,
    currentAccountId,
    setCurrentAccountId,
    hasAccounts,
    openAccountDialog,
    startTransaction: openTransactionForm,
  }), [editingTxn?.id, editTransaction, cancelEdit, currentAccountId, hasAccounts, openAccountDialog, openTransactionForm]);

  return (
    <BudgetUIProvider value={uiCtx}>
      <ModHintProvider>
      <div className="flex h-screen flex-col">
        {/* Header — full width, top */}
        <header className="relative z-40 grid grid-cols-3 items-center border-b px-4 py-2 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="sm" className="gap-1.5 font-semibold" />
                }
              >
                {shortenPath(path, 21)}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-48">
                {!__IS_DEMO__ && (
                  <>
                    <DropdownMenuItem onClick={() => shellOpen(path)}>
                      <FolderOpen className="h-4 w-4" />
                      {t("shell.revealInFinder")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => navigate({ to: "/" })}>
                  <LogOut className="h-4 w-4" />
                  {t("shell.closeBudget")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative flex justify-center">
            {!isArchivedView && (
              <>
                <button
                  type="button"
                  onClick={toggleForm}
                  className={`group flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    effectiveFormOpen
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                  aria-label={effectiveFormOpen ? t("shell.closeTransactionForm") : t("shell.addTransaction")}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${effectiveFormOpen ? "rotate-180" : ""}`} />
                  <span>{t("shell.newTransaction")}</span>
                </button>
                <ModHintBadge className="left-1/2 top-full mt-1.5 -translate-x-1/2">
                  {modKey}N
                </ModHintBadge>
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-1">
            <div className="hidden md:flex items-center gap-1">
              {__IS_DEMO__ && (
                <a
                  href="https://capybudget.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("shell.getDesktopApp")}
                  title={t("shell.getDesktopApp")}
                  className={buttonVariants({ variant: "default" })}
                >
                  <Download className="h-4 w-4" />
                  {t("shell.getDesktopApp")}
                </a>
              )}
              {__IS_DEMO__ && (
                <a
                  href="https://github.com/vladimir-e/capybudget"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("shell.viewSource")}
                  title={t("shell.viewSource")}
                  className={buttonVariants({ variant: "ghost" })}
                >
                  <Github className="h-4 w-4" />
                  {t("shell.github")}
                </a>
              )}
              <ColorThemeSwitcher />
              <ThemeToggle />
            </div>
            <div className="relative md:ml-1.5 md:border-l md:border-border/50 md:pl-2.5">
              <CapyButton
                active={capyOpen}
                onClick={() => setCapyOpen((prev) => !prev)}
              />
              <ModHintBadge className="left-1/2 top-full mt-1.5 -translate-x-1/2">
                {modKey}I
              </ModHintBadge>
            </div>
          </div>
        </header>

        {/* Below header: rail + sidebar + content */}
        <div className="relative flex flex-1 overflow-hidden">
          <NavigationRail
            budgetPath={path}
            budgetName={name}
            activeSection={activeSection}
            hasImportData={hasImportData || isImportBusy}
          />

          {/* Accounts sidebar — slides in/out, same behavior all viewports */}
          {activeSection === "accounts" && (
            <>
              <div
                className={`overflow-hidden transition-[width] duration-200 ease-out shrink-0 ${
                  sidebarCollapsed ? "w-0" : "w-72"
                }`}
                {...(sidebarCollapsed ? { inert: true, "aria-hidden": true } : {})}
              >
                <Sidebar
                  budgetPath={path}
                  budgetName={name}
                  onAddAccount={() => setAccountDialogOpen(true)}
                  onEditAccount={(account) => { setEditingAccount(account); setAccountDialogOpen(true); }}
                  onReorderAccounts={handleReorderAccounts}
                />
              </div>
              {/* Edge handle — always visible */}
              <button
                type="button"
                onClick={() => setSidebarCollapsed((prev) => !prev)}
                className="flex w-4 shrink-0 items-center justify-center border-r border-sidebar-border bg-sidebar text-muted-foreground/30 hover:text-muted-foreground hover:bg-sidebar-accent transition-colors"
                aria-label={sidebarCollapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronLeft className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}

          <main className="relative flex-1 overflow-x-auto overflow-y-auto bg-background pb-14 md:pb-0 min-w-0">
            <Outlet />
          </main>

          {effectiveFormOpen && (
            <div
              className="absolute inset-0 z-[9] bg-black/5 backdrop-blur-[1px] transition-opacity"
              onClick={handleDismissForm}
            />
          )}
          <div
            ref={formPanelRef}
            className={`absolute top-0 inset-x-0 z-10 flex justify-center transition-transform duration-250 ease-out ${
              effectiveFormOpen ? "translate-y-0" : "-translate-y-full"
            }`}
            {...(!effectiveFormOpen ? { inert: true, "aria-hidden": true } : {})}
          >
            {/* deliberate: floating form panel uses heavier elevation than dialog */}
            <div className="w-full max-w-sm rounded-b-2xl border-x border-b bg-background shadow-2xl px-6 pt-5 pb-4">
              <TransactionForm
                key={formKey}
                amountRef={amountRef}
                editingTransaction={editingTxn}
                defaultAccountId={currentAccountId}
                onSave={handleSave}
                onCancel={cancelEdit}
                onDismiss={handleDismissForm}
              />
            </div>
          </div>
        </div>
      </div>

      <CapyOverlay
        instructions={customInstructions.instructions}
        onSaveInstructions={customInstructions.save}
        commands={customCommands.commands}
        onSaveCommands={customCommands.save}
      />

      <AccountDialog
        key={editingAccount?.id ?? "new"}
        open={accountDialogOpen}
        onOpenChange={(open) => {
          setAccountDialogOpen(open);
          if (!open) setEditingAccount(null);
        }}
        editingAccount={editingAccount}
      />
      </ModHintProvider>
    </BudgetUIProvider>
  );
}
