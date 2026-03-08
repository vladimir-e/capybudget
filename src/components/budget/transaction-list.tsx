import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import type { Account, Category, Transaction } from "@/lib/types";
import { Inbox } from "lucide-react";

interface TransactionListProps {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  showAccountColumn: boolean;
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
  accounts,
  categories,
  showAccountColumn,
}: TransactionListProps) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // Sort by datetime descending
  const sorted = [...transactions].sort(
    (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-3 opacity-40" />
        <p className="text-lg font-medium">No transactions yet</p>
        <p className="text-sm mt-1">Transactions will appear here once added.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[120px]">Date</TableHead>
          {showAccountColumn && <TableHead>Account</TableHead>}
          <TableHead>Category</TableHead>
          <TableHead>Merchant</TableHead>
          <TableHead className="text-right w-[130px]">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((txn) => {
          const account = accountMap.get(txn.accountId);

          // For transfers, find the paired transaction's account
          let categoryDisplay: string;
          if (txn.type === "transfer") {
            const pairedTxn = transactions.find((t) => t.id === txn.transferPairId);
            const pairedAccount = pairedTxn ? accountMap.get(pairedTxn.accountId) : null;
            if (txn.amount < 0) {
              categoryDisplay = `${account?.name ?? "?"} → ${pairedAccount?.name ?? "?"}`;
            } else {
              categoryDisplay = `${pairedAccount?.name ?? "?"} → ${account?.name ?? "?"}`;
            }
          } else if (txn.categoryId) {
            categoryDisplay = categoryMap.get(txn.categoryId)?.name ?? "Uncategorized";
          } else {
            categoryDisplay = "Uncategorized";
          }

          return (
            <TableRow key={txn.id}>
              <TableCell className="text-muted-foreground">
                {formatDate(txn.datetime)}
              </TableCell>
              {showAccountColumn && (
                <TableCell>{account?.name ?? "Unknown"}</TableCell>
              )}
              <TableCell>
                {txn.type === "transfer" ? (
                  <span className="text-muted-foreground">{categoryDisplay}</span>
                ) : (
                  categoryDisplay
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {txn.type === "transfer" ? "Transfer" : txn.merchant}
              </TableCell>
              <TableCell className={`text-right tabular-nums font-medium ${getAmountClass(txn)}`}>
                {formatMoney(txn.amount)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
