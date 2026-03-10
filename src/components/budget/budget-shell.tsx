import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/budget/sidebar";
import { AddAccountDialog } from "@/components/budget/add-account-dialog";
import { TransactionForm } from "@/components/budget/transaction-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { BudgetUIProvider, type BudgetUIContextValue } from "@/contexts/budget-context";
import {
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
} from "@/hooks/use-transaction-mutations";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { useReorderAccounts } from "@/hooks/use-account-mutations";
import { useAccounts } from "@/hooks/use-budget-data";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, FolderOpen, LogOut } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { Transaction } from "@/lib/types";
import type { TransactionFormData } from "@/services/transactions";
import { toast } from "sonner";

interface BudgetShellProps {
  path: string;
  name: string;
}

function shortenPath(path: string, maxLen: number): string {
  const shortened = path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
  if (shortened.length <= maxLen) return shortened;
  const keep = maxLen - 1;
  const tail = Math.ceil(keep / 2);
  const head = keep - tail;
  return shortened.slice(0, head) + "…" + shortened.slice(-tail);
}

export function BudgetShell({ path, name }: BudgetShellProps) {
  const navigate = useNavigate();
  const createTxn = useCreateTransaction();
  const updateTxn = useUpdateTransaction();
  const deleteTxnMutation = useDeleteTransaction();
  const { undo, redo } = useUndoRedo();
  const reorderAccounts = useReorderAccounts();
  const { data: accounts = [] } = useAccounts();
  const hasAccounts = accounts.some((a) => !a.archived);

  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | undefined>();
  const amountRef = useRef<HTMLInputElement>(null);
  const formKey = editingTxn?.id ?? "new";

  const isMac = navigator.userAgent.includes("Mac");

  const toggleForm = useCallback(() => {
    if (!hasAccounts) {
      setAddAccountOpen(true);
      return;
    }
    setFormOpen((prev) => {
      if (prev) setEditingTxn(null);
      return !prev;
    });
  }, [hasAccounts]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "n") {
        e.preventDefault();
        toggleForm();
      }
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleForm, undo, redo]);

  useEffect(() => {
    if (formOpen) {
      const timer = setTimeout(() => amountRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [formOpen, formKey]);

  const handleReorderAccounts = useCallback(
    (type: import("@/lib/types").AccountType, orderedIds: string[]) => {
      reorderAccounts.mutate({ type, orderedIds });
    },
    [reorderAccounts],
  );

  const handleSave = useCallback((data: TransactionFormData) => {
    if (data.id) {
      updateTxn.mutate(data);
      setEditingTxn(null);
      setFormOpen(false);
      toast.success("Transaction updated");
    } else {
      createTxn.mutate(data);
      toast.success("Transaction added");
    }
  }, [createTxn, updateTxn]);

  const handleDelete = useCallback((txn: Transaction) => {
    deleteTxnMutation.mutate(txn);
    setEditingTxn((current) => {
      if (current?.id === txn.id) {
        setFormOpen(false);
        return null;
      }
      return current;
    });
    toast.success("Transaction deleted");
  }, [deleteTxnMutation]);

  const editTransaction = useCallback((txn: Transaction) => {
    setEditingTxn(txn);
    setFormOpen(true);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingTxn(null);
    setFormOpen(false);
  }, []);

  const handleDismissForm = () => {
    setFormOpen(false);
    setEditingTxn(null);
  };

  const uiCtx = useMemo<BudgetUIContextValue>(() => ({
    editingTxnId: editingTxn?.id,
    editTransaction,
    cancelEdit,
    deleteTransaction: handleDelete,
    currentAccountId,
    setCurrentAccountId,
  }), [editingTxn?.id, editTransaction, cancelEdit, handleDelete, currentAccountId]);

  return (
    <BudgetUIProvider value={uiCtx}>
      <div className="flex h-screen flex-col">
        <header className="grid grid-cols-3 items-center border-b px-4 py-2 bg-background/80 backdrop-blur-sm">
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
                <DropdownMenuItem onClick={() => shellOpen(path)}>
                  <FolderOpen className="h-4 w-4" />
                  Reveal in Finder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/" })}>
                  <LogOut className="h-4 w-4" />
                  Close Budget
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={toggleForm}
              className={`group flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                formOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
              aria-label={formOpen ? "Close transaction form" : "Add transaction"}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${formOpen ? "rotate-180" : ""}`} />
              <span>New Transaction</span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70 border border-border/50">
                {isMac ? "\u2318" : "Ctrl+"}N
              </kbd>
            </button>
          </div>
          <div className="flex items-center justify-end gap-1">
            <ColorThemeSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="relative flex flex-1 overflow-hidden">
          <Sidebar
            budgetPath={path}
            budgetName={name}
            onAddAccount={() => setAddAccountOpen(true)}
            onReorderAccounts={handleReorderAccounts}
          />
          <main className="flex-1 overflow-auto bg-background">
            <Outlet />
          </main>
          <div
            className={`absolute top-0 inset-x-0 z-10 flex justify-center transition-transform duration-250 ease-out ${
              formOpen ? "translate-y-0" : "-translate-y-full"
            }`}
          >
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

        <AddAccountDialog
          open={addAccountOpen}
          onOpenChange={setAddAccountOpen}
        />
      </div>
    </BudgetUIProvider>
  );
}
