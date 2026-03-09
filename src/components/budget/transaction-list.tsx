import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { resolveTransferPair } from "@/lib/queries";
import { useBudget } from "@/contexts/budget-context";
import type { Transaction } from "@/lib/types";
import { ArrowRight, Inbox, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

interface TransactionListProps {
  transactions: Transaction[];
  showAccountColumn: boolean;
  editingTransactionId?: string | null;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getAmountClass(txn: Transaction): string {
  if (txn.type === "transfer") return "text-amount-transfer";
  if (txn.amount < 0) return "text-amount-expense";
  return "text-amount-income";
}

export function TransactionList({
  transactions,
  showAccountColumn,
  editingTransactionId,
  onEdit,
  onDelete,
}: TransactionListProps) {
  const { accounts, categories, transactions: allTransactions } = useBudget();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const hasActions = !!(onEdit || onDelete);

  // Sort by datetime descending
  const sorted = [...transactions].sort(
    (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-3 opacity-30" strokeWidth={1.5} />
        <p className="text-base font-medium">No transactions yet</p>
        <p className="text-sm mt-1 opacity-70">Transactions will appear here once added.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent border-b-2 border-border">
          <TableHead className="w-[120px] text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Date</TableHead>
          {showAccountColumn && <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Account</TableHead>}
          <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Category</TableHead>
          <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Merchant</TableHead>
          <TableHead className="text-right w-[130px] text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Amount</TableHead>
          {hasActions && <TableHead className="w-[48px]" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((txn, i) => {
          const account = accountMap.get(txn.accountId);
          const isBeingEdited = txn.id === editingTransactionId;

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
              <span className="text-muted-foreground/50 italic">Uncategorized</span>
            );
          } else {
            categoryDisplay = <span className="text-muted-foreground/50 italic">Uncategorized</span>;
          }

          const rowBg = isBeingEdited
            ? "bg-brand-subtle/40 ring-1 ring-brand/20"
            : i % 2 === 0 ? "bg-transparent" : "bg-muted/30";

          return (
            <TableRow
              key={txn.id}
              className={`transition-colors border-border/50 ${rowBg} ${
                isBeingEdited ? "" : "hover:bg-brand-subtle/50"
              }`}
            >
              <TableCell className="text-muted-foreground text-[13px]">
                {formatDate(txn.datetime)}
              </TableCell>
              {showAccountColumn && (
                <TableCell className="font-medium text-[13px]">{account?.name ?? "Unknown"}</TableCell>
              )}
              <TableCell className="text-[13px]">
                {categoryDisplay}
              </TableCell>
              <TableCell className="text-muted-foreground text-[13px]">
                {txn.type === "transfer" ? (
                  <span className="text-muted-foreground/50">Transfer</span>
                ) : txn.merchant}
              </TableCell>
              <TableCell className={`text-right tabular-nums font-semibold text-[13px] ${getAmountClass(txn)}`}>
                {formatMoney(txn.amount)}
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
                          Edit
                        </DropdownMenuItem>
                      )}
                      {onDelete && (
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(txn)}>
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
