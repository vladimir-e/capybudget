import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionForm, type TransactionFormData } from "@/components/budget/transaction-form";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import type { Transaction } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/budget/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  const [transactions, setTransactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

  const handleSave = (data: TransactionFormData) => {
    const now = new Date().toISOString();

    if (data.id) {
      // Edit existing
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
      toast.success("Transaction updated");
    } else {
      // Add new
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

  const handleDelete = () => {
    if (!deletingTxn) return;
    setTransactions((prev) => {
      if (deletingTxn.type === "transfer" && deletingTxn.transferPairId) {
        return prev.filter((t) => t.id !== deletingTxn.id && t.id !== deletingTxn.transferPairId);
      }
      return prev.filter((t) => t.id !== deletingTxn.id);
    });
    if (editingTxn?.id === deletingTxn.id) setEditingTxn(null);
    setDeletingTxn(null);
    toast.success("Transaction deleted");
  };

  return (
    <div>
      <div className="px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
        <h2 className="text-xl font-bold tracking-tight">All Accounts</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="p-6 space-y-4">
      <TransactionForm
        key={editingTxn?.id ?? "new"}
        accounts={MOCK_ACCOUNTS}
        categories={MOCK_CATEGORIES}
        allTransactions={transactions}
        editingTransaction={editingTxn}
        onSave={handleSave}
        onCancel={() => setEditingTxn(null)}
      />

      <TransactionToolbar categories={MOCK_CATEGORIES} />

      <TransactionList
        transactions={transactions}
        allTransactions={transactions}
        accounts={MOCK_ACCOUNTS}
        categories={MOCK_CATEGORIES}
        showAccountColumn={true}
        editingTransactionId={editingTxn?.id}
        onEdit={setEditingTxn}
        onDelete={setDeletingTxn}
      />

      <DeleteTransactionDialog
        transaction={deletingTxn}
        allTransactions={transactions}
        accounts={MOCK_ACCOUNTS}
        categories={MOCK_CATEGORIES}
        onConfirm={handleDelete}
        onCancel={() => setDeletingTxn(null)}
      />
      </div>
    </div>
  );
}
