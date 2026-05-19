import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  TransactionsBrowser,
  type LockedFilters,
} from "@/components/budget/transactions-browser";
import type { Transaction } from "@capybudget/core";

interface TransactionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactions: Transaction[];
  lockedFilters: LockedFilters;
  title: string;
  subtitle?: string;
}

/** Modal wrapper around `TransactionsBrowser`. The browser is reused
 *  unmodified for the future Capy chat block — only this wrapper is
 *  modal-specific. */
export function TransactionsModal({
  open,
  onOpenChange,
  transactions,
  lockedFilters,
  title,
  subtitle,
}: TransactionsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col p-5">
        <TransactionsBrowser
          transactions={transactions}
          lockedFilters={lockedFilters}
          title={title}
          subtitle={subtitle}
        />
      </DialogContent>
    </Dialog>
  );
}
