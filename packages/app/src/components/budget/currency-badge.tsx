/** A small muted currency-code tag (e.g. "IDR") shown beside accounts and
 *  transaction rows in a multi-currency budget so the user can tell which
 *  currency a figure is in. The code reads less ambiguously than the symbol at
 *  this size — several currencies share "$". Callers gate on `useIsMultiCurrency`
 *  before rendering, so this stays absent in single-currency budgets. */
export function CurrencyBadge({ currency, className }: { currency: string; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tabular-nums leading-none text-muted-foreground ${className ?? ""}`}
    >
      {currency}
    </span>
  );
}
