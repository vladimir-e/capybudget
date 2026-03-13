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
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import {
  useBulkDeleteTransactions,
  useBulkAssignCategory,
  useBulkMoveAccount,
  useBulkChangeDate,
  useBulkChangeMerchant,
} from "@/hooks/use-bulk-transaction-mutations";
import { pluralize } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { toDateString, formatDateLabel } from "@/lib/date-utils";
import type { Transaction } from "@/lib/types";
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
  const totalAmount = selected.reduce((sum, t) => sum + t.amount, 0);

  const categoryIds = new Set(selected.filter((t) => t.type !== "transfer").map((t) => t.categoryId));
  const hasTransfers = selected.some((t) => t.type === "transfer");
  const nonTransferCount = selected.filter((t) => t.type !== "transfer").length;

  const handleDelete = () => {
    bulkDelete.mutate(selectedIds);
    onClear();
    setShowDeleteDialog(false);
    toast.success(`Deleted ${pluralize(count, "transaction")}`);
  };

  const handleCategoryChange = (categoryId: string | null) => {
    bulkCategory.mutate({ ids: selectedIds, categoryId: categoryId ?? "" });
    const label = categories.find((c) => c.id === categoryId)?.name ?? "Uncategorized";
    toast.success(`Categorized ${pluralize(nonTransferCount, "transaction")} as ${label}`);
  };

  const handleMoveAccount = (accountId: string) => {
    if (!accountId) return;
    bulkMove.mutate({ ids: selectedIds, accountId });
    setOverflowDialog(null);
    const label = accounts.find((a) => a.id === accountId)?.name ?? "account";
    toast.success(`Moved ${pluralize(nonTransferCount, "transaction")} to ${label}`);
  };

  const handleDateChange = (date: Date) => {
    bulkDate.mutate({ ids: selectedIds, date: toDateString(date) });
    setOverflowDialog(null);
    toast.success(`Changed date for ${pluralize(count, "transaction")} to ${formatDateLabel(toDateString(date))}`);
  };

  const handleMerchantSubmit = () => {
    const trimmed = merchantValue.trim();
    if (!trimmed) return;
    bulkMerchant.mutate({ ids: selectedIds, merchant: trimmed });
    setOverflowDialog(null);
    setMerchantValue("");
    toast.success(`Changed merchant for ${pluralize(nonTransferCount, "transaction")}`);
  };

  if (count === 0) return null;

  const categoryPlaceholder =
    categoryIds.size > 1
      ? "Mixed categories"
      : categoryIds.size === 1
        ? (categories.find((c) => c.id === [...categoryIds][0])?.name ?? "Uncategorized")
        : "Uncategorized";

  return (
    <>
      {/* Floating bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm shadow-xl px-4 py-2.5">
          {/* Summary */}
          <div className="flex items-center gap-3 border-r border-border/40 pr-3">
            <span className="text-sm font-medium tabular-nums">
              {count} selected
            </span>
            <span className="text-sm text-muted-foreground tabular-nums font-semibold">
              {formatMoney(totalAmount)}
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
            Delete
          </Button>

          {/* Overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon-sm" className="text-muted-foreground" />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-48">
              <DropdownMenuItem onClick={() => setOverflowDialog("move")}>
                <FolderInput className="h-3.5 w-3.5" />
                Move to account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setOverflowDialog("date")}>
                <CalendarDays className="h-3.5 w-3.5" />
                Change date
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setOverflowDialog("merchant")}>
                <Store className="h-3.5 w-3.5" />
                Change merchant
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Dismiss */}
          <button
            type="button"
            onClick={onClear}
            className="ml-1 text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowDeleteDialog(false); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete {pluralize(count, "transaction")}?</DialogTitle>
              <DialogDescription>
                This will permanently delete {pluralize(count, "transaction")} totalling {formatMoney(totalAmount)}.
                {hasTransfers && " Transfer pairs will be deleted on both sides."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>
                Delete {pluralize(count, "transaction")}
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
              <DialogTitle>Move to account</DialogTitle>
              <DialogDescription>
                Move {pluralize(nonTransferCount, "transaction")} to another account.
                {hasTransfers && " Transfers will be skipped."}
              </DialogDescription>
            </DialogHeader>
            <AccountSelector
              accounts={accounts}
              value=""
              onChange={handleMoveAccount}
              placeholder="Select account…"
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
              <DialogTitle>Change date</DialogTitle>
              <DialogDescription>
                Set a new date for {pluralize(count, "transaction")}.
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
              <DialogTitle>Change merchant</DialogTitle>
              <DialogDescription>
                Set a new merchant name for {pluralize(nonTransferCount, "transaction")}.
                {hasTransfers && " Transfers will be skipped."}
              </DialogDescription>
            </DialogHeader>
            <input
              type="text"
              value={merchantValue}
              onChange={(e) => setMerchantValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleMerchantSubmit(); }}
              placeholder="Merchant name"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOverflowDialog(null); setMerchantValue(""); }}>Cancel</Button>
              <Button onClick={handleMerchantSubmit} disabled={!merchantValue.trim()}>Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
