import { useMemo, useState } from "react"
import { List } from "lucide-react"
import {
  formatMoney,
  getAmountClass,
  parseLocalDate,
} from "@capybudget/core"
import type { TransactionsBlock, TransactionsFilter } from "@capybudget/intelligence"
import { useTransactions, useCategories } from "@/hooks/use-budget-data"
import { TransactionsModal } from "@/components/budget/transactions-modal"
import type { LockedFilters } from "@/components/budget/transactions-browser"
import { applyTransactionsFilter } from "@/lib/apply-transactions-filter"

function formatShortDate(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  const now = new Date()
  const month = d.toLocaleDateString("en-US", { month: "short" })
  const day = d.getDate()
  if (d.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${d.getFullYear()}`
  }
  return `${month} ${day}`
}

function deriveLockedFilters(filter: TransactionsFilter): LockedFilters {
  const locked: LockedFilters = {}
  if (filter.merchant) locked.merchant = filter.merchant
  if (filter.categoryId) locked.categoryId = filter.categoryId
  if (filter.dateRange) {
    locked.dateRange = {
      from: parseLocalDate(filter.dateRange.from),
      to: parseLocalDate(filter.dateRange.to),
    }
  }
  return locked
}

export function TransactionsBlockView({ block }: { block: TransactionsBlock }) {
  const { data: allTransactions } = useTransactions()
  const { data: categories } = useCategories()

  const filtered = useMemo(
    () => applyTransactionsFilter(allTransactions ?? [], block.filter),
    [allTransactions, block.filter],
  )

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories ?? []) m.set(c.id, c.name)
    return m
  }, [categories])

  const [modalOpen, setModalOpen] = useState(false)

  if (!allTransactions) return null

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-border/30 bg-muted/20 px-4 py-3">
        <p className="text-sm text-muted-foreground">No matching transactions</p>
      </div>
    )
  }

  if (filtered.length <= 5) {
    return (
      <div className="space-y-1.5">
        {filtered.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border border-border/30 bg-card/40 px-3 py-2"
          >
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums w-14">
              {formatShortDate(t.datetime.slice(0, 10))}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
              {t.merchant || "—"}
            </span>
            <span className={`shrink-0 text-sm font-medium tabular-nums ${getAmountClass(t)}`}>
              {formatMoney(t.amount)}
            </span>
            <span className="shrink-0 max-w-24 truncate text-xs text-muted-foreground">
              {categoryMap.get(t.categoryId) ?? ""}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const total = filtered.reduce((s, t) => s + t.amount, 0)

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="w-full rounded-xl border border-border/30 bg-card/40 px-4 py-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
      >
        <div className="flex items-center gap-2.5">
          <List className="h-4 w-4 shrink-0 text-brand" />
          <span className="flex-1 text-sm font-medium text-foreground/90">
            {block.label}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {filtered.length} transactions
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2.5 pl-6.5">
          <span className="text-xs font-medium tabular-nums text-foreground/70">
            {formatMoney(total)}
          </span>
          {block.summary && (
            <span className="truncate text-xs text-muted-foreground">
              — {block.summary}
            </span>
          )}
        </div>
      </button>
      <TransactionsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        transactions={filtered}
        lockedFilters={deriveLockedFilters(block.filter)}
        title={block.label}
        subtitle={block.summary}
      />
    </>
  )
}
