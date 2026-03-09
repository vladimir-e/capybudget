import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/budget/sidebar";
import { AddAccountDialog } from "@/components/budget/add-account-dialog";
import { TransactionForm, type TransactionFormData } from "@/components/budget/transaction-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { ColorThemeSwitcher } from "@/components/color-theme-switcher";
import { BudgetProvider, type BudgetContextValue } from "@/contexts/budget-context";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { ChevronDown, ChevronLeft } from "lucide-react";
import type { AccountType, Transaction } from "@/lib/types";
import { toast } from "sonner";

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
  const [accounts, setAccounts] = useState(MOCK_ACCOUNTS);
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [currentAccountId, setCurrentAccountId] = useState<string | undefined>();
  const amountRef = useRef<HTMLInputElement>(null);
  const formKey = editingTxn?.id ?? "new";

  const isMac = navigator.platform.includes("Mac");

  const toggleForm = useCallback(() => {
    setFormOpen((prev) => {
      if (prev) setEditingTxn(null);
      return !prev;
    });
  }, []);

  // Keyboard shortcut: Cmd+N / Ctrl+N
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        toggleForm();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleForm]);

  // Focus amount when panel opens or form remounts
  useEffect(() => {
    if (formOpen) {
      const timer = setTimeout(() => amountRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [formOpen, formKey]);

  const handleReorderAccounts = useCallback(
    (type: AccountType, orderedIds: string[]) => {
      setAccounts((prev) =>
        prev.map((a) => {
          if (a.type !== type) return a;
          const idx = orderedIds.indexOf(a.id);
          return idx === -1 ? a : { ...a, sortOrder: idx };
        }),
      );
    },
    [],
  );

  const handleSave = (data: TransactionFormData) => {
    const now = new Date().toISOString();

    if (data.id) {
      setTransactions((prev) => {
        if (data.type === "transfer") {
          const original = prev.find((t) => t.id === data.id);
          const pairId = original?.transferPairId;
          return prev.map((t) => {
            if (t.id === data.id) {
              return { ...t, amount: -data.amount, accountId: data.accountId, datetime: `${data.date}T12:00:00.000Z`, merchant: data.merchant, note: data.note };
            }
            if (pairId && t.id === pairId) {
              return { ...t, amount: data.amount, accountId: data.toAccountId!, datetime: `${data.date}T12:00:00.000Z`, merchant: data.merchant, note: data.note };
            }
            return t;
          });
        }
        return prev.map((t) =>
          t.id === data.id
            ? { ...t, type: data.type, amount: data.type === "expense" ? -data.amount : data.amount, categoryId: data.categoryId, accountId: data.accountId, datetime: `${data.date}T12:00:00.000Z`, merchant: data.merchant, note: data.note }
            : t,
        );
      });
      setEditingTxn(null);
      setFormOpen(false);
      toast.success("Transaction updated");
    } else {
      if (data.type === "transfer") {
        const fromId = crypto.randomUUID();
        const toId = crypto.randomUUID();
        const base = { datetime: `${data.date}T12:00:00.000Z`, type: "transfer" as const, categoryId: "", merchant: data.merchant, note: data.note, createdAt: now };
        setTransactions((prev) => [
          ...prev,
          { ...base, id: fromId, amount: -data.amount, accountId: data.accountId, transferPairId: toId },
          { ...base, id: toId, amount: data.amount, accountId: data.toAccountId!, transferPairId: fromId },
        ]);
      } else {
        setTransactions((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            datetime: `${data.date}T12:00:00.000Z`,
            type: data.type,
            amount: data.type === "expense" ? -data.amount : data.amount,
            categoryId: data.categoryId,
            accountId: data.accountId,
            transferPairId: "",
            merchant: data.merchant,
            note: data.note,
            createdAt: now,
          },
        ]);
      }
      toast.success("Transaction added");
    }
  };

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

  const budgetCtx = useMemo<BudgetContextValue>(() => ({
    transactions,
    setTransactions,
    editingTxnId: editingTxn?.id,
    editTransaction,
    cancelEdit,
    currentAccountId,
    setCurrentAccountId,
  }), [transactions, setTransactions, editingTxn?.id, editTransaction, cancelEdit, currentAccountId]);

  return (
    <BudgetProvider value={budgetCtx}>
      <div className="flex h-screen flex-col">
        <header className="grid grid-cols-3 items-center border-b px-4 py-2 bg-background/80 backdrop-blur-sm">
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
            accounts={accounts}
            transactions={transactions}
            budgetPath={path}
            budgetName={name}
            onAddAccount={() => setAddAccountOpen(true)}
            onReorderAccounts={handleReorderAccounts}
          />
          <main className="flex-1 overflow-auto bg-background">
            <Outlet />
          </main>
          {/* Slide-down form overlay — centered across full width */}
          <div
            className={`absolute top-0 inset-x-0 z-10 flex justify-center transition-transform duration-250 ease-out ${
              formOpen ? "translate-y-0" : "-translate-y-full"
            }`}
          >
            <div className="w-full max-w-sm rounded-b-2xl border-x border-b bg-background shadow-2xl px-6 pt-5 pb-4">
              <TransactionForm
                key={formKey}
                amountRef={amountRef}
                accounts={MOCK_ACCOUNTS}
                categories={MOCK_CATEGORIES}
                allTransactions={transactions}
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
    </BudgetProvider>
  );
}
