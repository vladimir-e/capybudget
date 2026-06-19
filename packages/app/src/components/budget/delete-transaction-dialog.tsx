import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Transaction } from "@capybudget/core";
import { formatDateLabel, resolveTransferPair } from "@capybudget/core";
import { useLocale, useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
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
  const { t } = useTranslation(["budget", "common"]);
  const locale = useLocale();
  const { format } = useFormatMoney();
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

  const formattedDate = formatDateLabel(transaction.datetime.slice(0, 10), locale);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{isTransfer ? t("transaction.delete.titleTransfer") : t("transaction.delete.titleTransaction")}</DialogTitle>
          <DialogDescription>
            {isTransfer
              ? t("transaction.delete.transferDescription")
              : t("transaction.delete.transactionDescription")}
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
              {format(Math.abs(transaction.amount))}
            </span>
          </div>
          <div className="text-foreground">
            {isTransfer
              ? transferLabel
              : category?.name ?? transaction.merchant ?? t("transaction.row.uncategorized")}
          </div>
          {!isTransfer && transaction.merchant && category && (
            <div className="text-muted-foreground text-xs">{transaction.merchant}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t("common:actions.cancel")}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t("common:actions.delete")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
