import { useLayoutEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
 *  modal-specific.
 *
 *  Renders a screen-reader-only `<DialogTitle>` so Base UI can wire
 *  `aria-labelledby` on the popup. The visible heading lives inside
 *  `TransactionsBrowser` (kept modal-agnostic), so the visual stays the
 *  same — only the accessibility name is added here.
 *
 *  Height-lock: on first paint after `open` flips true, we measure the
 *  popup's natural height (capped by `max-h-[80vh]`) and pin it for the
 *  rest of the open session. As the user types and the visible list
 *  shrinks, the modal stays the same size — the empty space appears
 *  inside the list region instead of yanking the search field upward
 *  under the cursor. The lock resets on close so the next open measures
 *  fresh against its own dataset. `offsetHeight` reads the layout box
 *  *before* CSS transforms are applied, so the popup's zoom-in
 *  animation (`data-open:zoom-in-95`) doesn't skew the measurement. */
export function TransactionsModal({
  open,
  onOpenChange,
  transactions,
  lockedFilters,
  title,
  subtitle,
}: TransactionsModalProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // Wait one frame so the portalled popup has mounted and layout has
    // settled before we read its natural height. The cleanup callback
    // resets the lock when this open-cycle ends, so the next opening
    // measures fresh against its own dataset.
    const raf = requestAnimationFrame(() => {
      if (popupRef.current) {
        setLockedHeight(popupRef.current.offsetHeight);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      setLockedHeight(null);
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        className="sm:max-w-3xl max-h-[80vh] flex flex-col p-5"
        style={lockedHeight !== null ? { height: lockedHeight } : undefined}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
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
