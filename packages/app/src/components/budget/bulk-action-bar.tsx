import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CategorySelector } from "@/components/budget/category-selector";
import { AccountSelector } from "@/components/budget/account-selector";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import {
  useBulkDeleteTransactions,
  useBulkAssignCategory,
  useBulkMoveAccount,
  useBulkChangeDate,
  useBulkChangeMerchant,
} from "@/hooks/use-bulk-transaction-mutations";
import type { Transaction } from "@capybudget/core";
import { toDateString } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatters } from "@/hooks/use-formatters";
import { useConverter, useAccountMoney } from "@/contexts/currency-context";
import { useCategoryDisplayName } from "@/lib/display-names";
import {
  CalendarDays,
  FolderInput,
  MoreHorizontal,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type OverflowDialog = null | "move" | "date" | "merchant";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  transactions: Transaction[];
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, transactions, onClear }: BulkActionBarProps) {
  const { t } = useTranslation(["budget", "common"]);
  const { money, date: formatDate } = useFormatters();
  const converter = useConverter();
  const accountMoney = useAccountMoney();
  const categoryDisplay = useCategoryDisplayName();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const bulkDelete = useBulkDeleteTransactions();
  const bulkCategory = useBulkAssignCategory();
  const bulkMove = useBulkMoveAccount();
  const bulkDate = useBulkChangeDate();
  const bulkMerchant = useBulkChangeMerchant();

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [overflowDialog, setOverflowDialog] = useState<OverflowDialog>(null);
  const [merchantValue, setMerchantValue] = useState("");

  const selected = transactions.filter((t) => selectedIds.has(t.id));
  const count = selected.length;
  const accountCurrency = (id: string) => accounts.find((a) => a.id === id)?.currency;

  // When every selected row is in one currency the total reads natively in it;
  // a selection spanning currencies has no native total, so it rolls up into the
  // default at each row's stamped rate (identity for a single-currency budget).
  const totalCurrencies = new Set(selected.map((t) => accountCurrency(t.accountId)));
  const totalCurrency = totalCurrencies.size === 1 ? [...totalCurrencies][0] : undefined;
  const totalAmount =
    totalCurrency !== undefined
      ? selected.reduce((sum, t) => sum + t.amount, 0)
      : selected.reduce((sum, t) => sum + converter.flowToDefault(t.amount, t.fxRate), 0);
  const totalLabel =
    totalCurrency !== undefined ? accountMoney(totalAmount, totalCurrency) : money(totalAmount);

  const categoryIds = new Set(selected.filter((t) => t.type !== "transfer").map((t) => t.categoryId));
  const hasTransfers = selected.some((t) => t.type === "transfer");
  const nonTransfers = selected.filter((t) => t.type !== "transfer");
  const nonTransferCount = nonTransfers.length;

  // A move keeps each amount native to its account's currency, so it's a
  // same-currency operation: the moved flows must share one currency, and only
  // accounts in that currency are valid targets. A selection spanning multiple
  // currencies can't move to any single account — the Move action disables.
  const movedCurrencies = new Set(nonTransfers.map((t) => accountCurrency(t.accountId)));
  const isMixedCurrency = movedCurrencies.size > 1;
  const moveCurrency = movedCurrencies.size === 1 ? [...movedCurrencies][0] : undefined;
  const moveDisabledIds = accounts
    .filter((a) => a.currency !== moveCurrency)
    .map((a) => a.id);

  const handleDelete = () => {
    bulkDelete.mutate(selectedIds);
    onClear();
    setShowDeleteDialog(false);
    toast.success(t("bulk.toast.deleted", { count }));
  };

  const handleCategoryChange = (categoryId: string | null) => {
    bulkCategory.mutate({ ids: selectedIds, categoryId: categoryId ?? "" });
    const name = categories.find((c) => c.id === categoryId)?.name;
    const label = name ? categoryDisplay(name) : t("bulk.uncategorized");
    toast.success(t("bulk.toast.categorized", { count: nonTransferCount, label }));
  };

  const handleMoveAccount = (accountId: string) => {
    if (!accountId) return;
    bulkMove.mutate({ ids: selectedIds, accountId });
    setOverflowDialog(null);
    const label = accounts.find((a) => a.id === accountId)?.name ?? t("account.fallbackLabel");
    toast.success(t("bulk.toast.moved", { count: nonTransferCount, label }));
  };

  const handleDateChange = (date: Date) => {
    bulkDate.mutate({ ids: selectedIds, date: toDateString(date) });
    setOverflowDialog(null);
    toast.success(t("bulk.toast.dateChanged", { count, date: formatDate(toDateString(date)) }));
  };

  const handleMerchantSubmit = () => {
    const trimmed = merchantValue.trim();
    if (!trimmed) return;
    bulkMerchant.mutate({ ids: selectedIds, merchant: trimmed });
    setOverflowDialog(null);
    setMerchantValue("");
    toast.success(t("bulk.toast.merchantChanged", { count: nonTransferCount }));
  };

  if (count === 0) return null;

  const categoryPlaceholder =
    categoryIds.size > 1
      ? t("bulk.mixedCategories")
      : categoryIds.size === 1
        ? (() => {
            const name = categories.find((c) => c.id === [...categoryIds][0])?.name;
            return name ? categoryDisplay(name) : t("bulk.uncategorized");
          })()
        : t("bulk.uncategorized");

  return (
    <>
      {/* Floating bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm shadow-overlay px-4 py-2.5">
          {/* Summary */}
          <div className="flex items-center gap-3 border-r border-border/40 pr-3">
            <span className="text-sm font-medium tabular-nums">
              {t("bulk.selected", { count })}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums font-semibold">
              {totalLabel}
            </span>
          </div>

          {/* Categorize (primary) */}
          {nonTransferCount > 0 && (
            <div className="[&_button:first-of-type]:h-7 [&_button:first-of-type]:text-xs">
              <CategorySelector
                categories={categories}
                value={null}
                onChange={handleCategoryChange}
                placeholder={categoryPlaceholder}
                includeUncategorized
              />
            </div>
          )}

          {/* Delete (primary) */}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("bulk.delete")}
          </Button>

          {/* Overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={t("bulk.moreActions")}
                />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-48">
              {isMixedCurrency ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuItem
                        aria-disabled
                        closeOnClick={false}
                        onClick={(e) => e.preventDefault()}
                        className="cursor-not-allowed opacity-50"
                      />
                    }
                  >
                    <FolderInput className="h-3.5 w-3.5" />
                    {t("bulk.moveToAccount")}
                  </TooltipTrigger>
                  <TooltipContent>{t("bulk.moveMixedCurrency")}</TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenuItem onClick={() => setOverflowDialog("move")}>
                  <FolderInput className="h-3.5 w-3.5" />
                  {t("bulk.moveToAccount")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setOverflowDialog("date")}>
                <CalendarDays className="h-3.5 w-3.5" />
                {t("bulk.changeDate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setOverflowDialog("merchant")}>
                <Store className="h-3.5 w-3.5" />
                {t("bulk.changeMerchant")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Dismiss */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClear}
            className="ml-1 text-muted-foreground/60"
            aria-label={t("bulk.clearSelection")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowDeleteDialog(false); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("bulk.deleteDialog.title", { count })}</DialogTitle>
              <DialogDescription>
                {t("bulk.deleteDialog.description", { count, total: totalLabel })}
                {hasTransfers && t("bulk.deleteDialog.transferNote")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>{t("common:actions.cancel")}</Button>
              <Button variant="destructive" onClick={handleDelete}>
                {t("bulk.deleteDialog.confirm", { count })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Move to account dialog */}
      {overflowDialog === "move" && (
        <Dialog open onOpenChange={(open) => { if (!open) setOverflowDialog(null); }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>{t("bulk.moveDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("bulk.moveDialog.description", { count: nonTransferCount })}
                {hasTransfers && t("bulk.moveDialog.transferNote")}
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground">{t("bulk.moveDialog.sameCurrencyTip")}</p>
            <AccountSelector
              accounts={accounts}
              value=""
              onChange={handleMoveAccount}
              disableIds={moveDisabledIds}
              defaultOpen
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Change date dialog */}
      {overflowDialog === "date" && (
        <Dialog open onOpenChange={(open) => { if (!open) setOverflowDialog(null); }}>
          <DialogContent className="sm:max-w-fit">
            <DialogHeader>
              <DialogTitle>{t("bulk.dateDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("bulk.dateDialog.description", { count })}
              </DialogDescription>
            </DialogHeader>
            <Calendar
              mode="single"
              onSelect={(d) => { if (d) handleDateChange(d); }}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Change merchant dialog */}
      {overflowDialog === "merchant" && (
        <Dialog open onOpenChange={(open) => { if (!open) { setOverflowDialog(null); setMerchantValue(""); } }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("bulk.merchantDialog.title")}</DialogTitle>
              <DialogDescription>
                {t("bulk.merchantDialog.description", { count: nonTransferCount })}
                {hasTransfers && t("bulk.merchantDialog.transferNote")}
              </DialogDescription>
            </DialogHeader>
            <input
              type="text"
              value={merchantValue}
              onChange={(e) => setMerchantValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleMerchantSubmit(); }}
              placeholder={t("bulk.merchantPlaceholder")}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOverflowDialog(null); setMerchantValue(""); }}>{t("common:actions.cancel")}</Button>
              <Button onClick={handleMerchantSubmit} disabled={!merchantValue.trim()}>{t("bulk.apply")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
