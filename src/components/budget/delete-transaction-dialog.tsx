import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { resolveTransferPair } from "@/lib/queries";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import type { Transaction } from "@/lib/types";
import { ArrowRight } from "lucide-react";

interface DeleteTransactionDialogProps {
  transaction: Transaction | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteTransactionDialog({
  transaction,
  onConfirm,
  onCancel,
}: DeleteTransactionDialogProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: allTransactions = [] } = useTransactions();

  if (!transaction) return null;

  const isTransfer = transaction.type === "transfer";
  const category = categories.find((c) => c.id === transaction.categoryId);

  let transferLabel: React.ReactNode = null;
  if (isTransfer) {
    const { fromAccountId, toAccountId } = resolveTransferPair(transaction, allTransactions);
    const fromName = accounts.find((a) => a.id === fromAccountId)?.name;
    const toName = accounts.find((a) => a.id === toAccountId)?.name;
    transferLabel = (
      <span className="inline-flex items-center gap-1.5">
        {fromName} <ArrowRight className="h-3 w-3 opacity-50" /> {toName}
      </span>
    );
  }

  const formattedDate = new Date(transaction.datetime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {isTransfer ? "Transfer" : "Transaction"}</DialogTitle>
          <DialogDescription>
            {isTransfer
              ? "This will delete both sides of the transfer."
              : "This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{formattedDate}</span>
            <span className={`font-semibold tabular-nums ${
              transaction.type === "transfer"
                ? "text-amount-transfer"
                : transaction.amount < 0
                  ? "text-amount-expense"
                  : "text-amount-income"
            }`}>
              {formatMoney(Math.abs(transaction.amount))}
            </span>
          </div>
          <div className="text-foreground">
            {isTransfer
              ? transferLabel
              : category?.name ?? transaction.merchant ?? "Uncategorized"}
          </div>
          {!isTransfer && transaction.merchant && category && (
            <div className="text-muted-foreground text-xs">{transaction.merchant}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
