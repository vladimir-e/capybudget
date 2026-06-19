import { memo } from "react";
import { TableCell } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InlineEditCell, type EditableColumn } from "@/components/budget/inline-edit-cells";
import type { Account, Category, Transaction, TransactionFormData } from "@capybudget/core";
import { formatDateLabel, getAmountClass, resolveTransferPair } from "@capybudget/core";
import { useLocale, useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { ArrowRight, Info, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export interface TransactionRowProps {
  txn: Transaction;
  showAccountColumn: boolean;
  accountMap: Map<string, Account>;
  categoryMap: Map<string, Category>;
  allTransactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  isEditable: boolean;
  activeCol: EditableColumn | null;
  isSelected: boolean;
  hasSelection: boolean;
  hasActions: boolean;
  onToggleSelect?: (txnId: string, shiftKey: boolean) => void;
  onCellClick: (txn: Transaction, column: EditableColumn) => void;
  onInlineSave: (data: TransactionFormData) => void;
  onInlineCancel: () => void;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}

export const TransactionRowMemo = memo(function TransactionRow({
  txn,
  showAccountColumn,
  accountMap,
  categoryMap,
  allTransactions,
  accounts,
  categories,
  isEditable,
  activeCol,
  isSelected,
  hasSelection,
  hasActions,
  onToggleSelect,
  onCellClick,
  onInlineSave,
  onInlineCancel,
  onEdit,
  onDelete,
}: TransactionRowProps) {
  const { t } = useTranslation(["budget", "common"]);
  const locale = useLocale();
  const { format } = useFormatMoney();
  const account = accountMap.get(txn.accountId);

  // Transfer display
  let categoryDisplay: React.ReactNode;
  if (txn.type === "transfer") {
    const { fromAccountId, toAccountId } = resolveTransferPair(txn, allTransactions);
    const fromName = accountMap.get(fromAccountId)?.name;
    const toName = accountMap.get(toAccountId)?.name;
    categoryDisplay = (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span>{fromName ?? "?"}</span>
        <ArrowRight className="h-3 w-3 opacity-50" />
        <span>{toName ?? "?"}</span>
      </span>
    );
  } else if (txn.categoryId) {
    categoryDisplay = categoryMap.get(txn.categoryId)?.name ?? (
      <span className="text-muted-foreground/50 italic">{t("transaction.row.uncategorized")}</span>
    );
  } else {
    categoryDisplay = <span className="text-muted-foreground/50 italic">{t("transaction.row.uncategorized")}</span>;
  }

  const isCellClickable = isEditable || (!!onEdit && txn.type === "transfer");
  const cellClickClass = isCellClickable ? "cursor-pointer" : "";

  // Returns a fragment of <TableCell> elements — the caller provides the <tr>.
  return (
    <>
      {hasSelection && (
        <TableCell
          className="px-3 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(txn.id, e.shiftKey);
          }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect?.(txn.id, false)}
            aria-label={t("transaction.list.select")}
          />
        </TableCell>
      )}
      <TableCell
        className={`text-muted-foreground text-[13px] ${cellClickClass}`}
        onClick={() => onCellClick(txn, "date")}
      >
        {activeCol === "date" ? (
          <InlineEditCell txn={txn} column="date" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : formatDateLabel(txn.datetime.slice(0, 10), locale)}
      </TableCell>
      {showAccountColumn && (
        <TableCell
          className={`font-medium text-[13px] ${cellClickClass}`}
          onClick={() => onCellClick(txn, "account")}
        >
          {activeCol === "account" ? (
            <InlineEditCell txn={txn} column="account" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
          ) : account?.name ?? t("transaction.row.unknownAccount")}
        </TableCell>
      )}
      <TableCell
        className={`text-muted-foreground text-[13px] max-w-[300px] overflow-hidden ${cellClickClass}`}
        onClick={() => onCellClick(txn, "merchant")}
      >
        {activeCol === "merchant" ? (
          <InlineEditCell txn={txn} column="merchant" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : (
          <div className="flex items-center min-w-0">
            <span className="truncate">
              {txn.type === "transfer" ? (
                <span className="text-muted-foreground/50">{t("transaction.row.transfer")}</span>
              ) : txn.merchant}
            </span>
            {txn.note && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="ml-auto pl-2 inline-flex shrink-0 cursor-pointer p-1.5 -m-1.5"
                      onClick={(e) => { e.stopPropagation(); onEdit?.(txn); }}
                      aria-label={t("transaction.row.editNote")}
                    />
                  }
                >
                  <Info className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" />
                </TooltipTrigger>
                <TooltipContent>{txn.note}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </TableCell>
      <TableCell
        className={`text-[13px] ${cellClickClass}`}
        onClick={() => onCellClick(txn, "category")}
      >
        {activeCol === "category" ? (
          <InlineEditCell txn={txn} column="category" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : categoryDisplay}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums font-semibold text-[13px] ${getAmountClass(txn)} ${cellClickClass}`}
        onClick={() => onCellClick(txn, "amount")}
      >
        {activeCol === "amount" ? (
          <InlineEditCell txn={txn} column="amount" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : format(txn.amount)}
      </TableCell>
      {hasActions && (
        <TableCell className="px-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground/50 hover:text-foreground" />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(txn)}>
                  <Pencil className="h-3.5 w-3.5" />
                  {t("common:actions.edit")}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(txn)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("common:actions.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
    </>
  );
});
