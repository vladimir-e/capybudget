import { useCallback, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { CategorySelector } from "@/components/budget/category-selector";
import { AccountSelector } from "@/components/budget/account-selector";
import type { ImportTransaction } from "@capybudget/core";
import type { Category, Account } from "@capybudget/core";
import { formatDateLabel } from "@capybudget/core";
import { useTranslation, useLocale } from "@capybudget/i18n";
import type { TFunction } from "i18next";
import { useFormatMoney } from "@/contexts/currency-context";
import {
  amountColorClass,
  type ImportSortColumn,
  type ImportSortConfig,
} from "@/components/import/import-table-utils";
import {
  DateEdit,
  MerchantEdit,
  AmountEdit,
  TypeEdit,
} from "./import-table-editors";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Copy,
  Inbox,
} from "lucide-react";

type EditableColumn = "date" | "merchant" | "amount" | "type";

interface ImportTableProps {
  transactions: ImportTransaction[];
  sort: ImportSortConfig;
  onSortChange: (sort: ImportSortConfig) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  indeterminate: boolean;
  onUpdateTransaction: (id: string, patch: Partial<ImportTransaction>) => void;
  categories: Category[];
  accounts: Account[];
  accountMapping: Record<string, string>;
  /** Opens the Map-accounts dialog (the ACCOUNT cell is its trigger). */
  onOpenAccountMapping: () => void;
  duplicateIds: Set<string>;
}

function defaultDirection(column: ImportSortColumn): "asc" | "desc" {
  return column === "date" ? "desc" : "asc";
}

// ── SortableHeader ──────────────────────────────────────────────

function SortableHeader({
  column,
  sort,
  onSortChange,
  align = "left",
  className,
  children,
}: {
  column: ImportSortColumn;
  sort: ImportSortConfig;
  onSortChange: (sort: ImportSortConfig) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sort.column === column;

  const handleClick = () => {
    if (isActive) {
      onSortChange({
        column,
        direction: sort.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ column, direction: defaultDirection(column) });
    }
  };

  const Icon = isActive
    ? sort.direction === "asc"
      ? ChevronUp
      : ChevronDown
    : ArrowUpDown;

  return (
    <TableHead
      className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={handleClick}
        className={`group inline-flex items-center gap-1 cursor-pointer select-none text-xs font-semibold uppercase tracking-wider ${
          isActive ? "text-foreground" : "text-muted-foreground/70"
        } ${align === "right" ? "ml-auto" : ""}`}
      >
        {children}
        <Icon
          className={`h-3 w-3 shrink-0 ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"
          } transition-opacity`}
        />
      </button>
    </TableHead>
  );
}

// ── ImportTable ──────────────────────────────────────────────────

export function ImportTable({
  transactions,
  sort,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  allSelected,
  indeterminate,
  onUpdateTransaction,
  categories,
  accounts,
  accountMapping,
  onOpenAccountMapping,
  duplicateIds,
}: ImportTableProps) {
  const { t } = useTranslation(["import", "common"]);
  const locale = useLocale();
  const { format } = useFormatMoney();
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    column: EditableColumn;
  } | null>(null);

  const handleCellClick = useCallback(
    (rowId: string, column: EditableColumn) => {
      setEditingCell((prev) =>
        prev?.rowId === rowId && prev?.column === column
          ? prev
          : { rowId, column },
      );
    },
    [],
  );

  const handleSave = useCallback(
    (id: string, column: EditableColumn, value: string | number) => {
      const patch: Partial<ImportTransaction> = {};
      if (column === "amount") {
        patch.amount = value as number;
      } else {
        (patch as Record<string, string>)[column] = value as string;
      }
      onUpdateTransaction(id, patch);
      setEditingCell(null);
    },
    [onUpdateTransaction],
  );

  const handleCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  if (transactions.length === 0) {
    return (
      <EmptyState
        icon={<Inbox strokeWidth={1.5} />}
        title={t("table.noTransactionsTitle")}
        description={t("table.noTransactionsDescription")}
        className="py-24"
      />
    );
  }

  return (
    <Table className="select-none">
      <TableHeader>
        <TableRow className="hover:bg-transparent border-b-2 border-border">
          <TableHead className="w-[40px] px-3">
            <Checkbox
              checked={allSelected}
              indeterminate={indeterminate}
              onCheckedChange={() => onToggleAll()}
              aria-label={t("table.selectAll")}
            />
          </TableHead>
          <SortableHeader column="date" sort={sort} onSortChange={onSortChange} className="w-[120px]">
            {t("table.columns.date")}
          </SortableHeader>
          <SortableHeader column="merchant" sort={sort} onSortChange={onSortChange}>
            {t("table.columns.merchant")}
          </SortableHeader>
          <SortableHeader column="amount" sort={sort} onSortChange={onSortChange} align="right" className="w-[120px]">
            {t("table.columns.amount")}
          </SortableHeader>
          <SortableHeader column="type" sort={sort} onSortChange={onSortChange} className="w-[90px]">
            {t("table.columns.type")}
          </SortableHeader>
          <SortableHeader column="sourceAccount" sort={sort} onSortChange={onSortChange} className="w-[140px]">
            {t("table.columns.account")}
          </SortableHeader>
          <SortableHeader column="categoryId" sort={sort} onSortChange={onSortChange} className="w-[180px]">
            {t("table.columns.category")}
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((txn, i) => {
          const isSelected = selectedIds.has(txn.id);
          const isDuplicate = duplicateIds.has(txn.id);
          // Low confidence = matched only through the relaxed ±day window — a
          // possible duplicate the user should review, not a settled one.
          const isPossibleDuplicate = isDuplicate && txn.duplicateConfidence === "low";
          const activeCol =
            editingCell?.rowId === txn.id ? editingCell.column : null;

          const rowBg = isDuplicate && !isSelected
            ? `${isPossibleDuplicate ? "bg-amber-500/5" : "bg-blue-500/5"} opacity-60`
            : isSelected
              ? i % 2 === 0
                ? "bg-transparent"
                : "bg-muted/30"
              : "bg-muted/10 opacity-50";

          return (
            <TableRow
              key={txn.id}
              className={`transition-colors border-border/50 hover:bg-brand-subtle/30 ${rowBg}`}
            >
              {/* Checkbox */}
              <TableCell
                className="px-3 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(txn.id, e.shiftKey);
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(txn.id, false)}
                    aria-label={t("table.includeTransaction")}
                  />
                  {isDuplicate && (
                    <span
                      title={
                        isPossibleDuplicate
                          ? t("table.possibleDuplicateTitle")
                          : t("table.duplicateTitle")
                      }
                    >
                      <Copy
                        className={`h-3 w-3 shrink-0 ${isPossibleDuplicate ? "text-amber-500" : "text-blue-500"}`}
                      />
                    </span>
                  )}
                </div>
              </TableCell>

              {/* Date */}
              <TableCell
                className="text-muted-foreground text-[13px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "date")}
              >
                {activeCol === "date" ? (
                  <DateEdit
                    value={txn.date}
                    onSave={(d) => handleSave(txn.id, "date", d)}
                    onCancel={handleCancel}
                  />
                ) : (
                  formatDateLabel(txn.date, locale)
                )}
              </TableCell>

              {/* Merchant */}
              <TableCell
                className="text-[13px] max-w-[250px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "merchant")}
              >
                {activeCol === "merchant" ? (
                  <MerchantEdit
                    value={txn.merchant || txn.description}
                    onSave={(v) => handleSave(txn.id, "merchant", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  <div className="min-w-0">
                    <span className="truncate block">
                      {txn.merchant || txn.description}
                    </span>
                    {txn.merchant && txn.merchant !== txn.description && (
                      <span className="truncate block text-[11px] text-muted-foreground/50">
                        {txn.description}
                      </span>
                    )}
                  </div>
                )}
              </TableCell>

              {/* Amount */}
              <TableCell
                className={`text-right tabular-nums font-semibold text-[13px] ${amountColorClass(txn)} cursor-pointer`}
                onClick={() => handleCellClick(txn.id, "amount")}
              >
                {activeCol === "amount" ? (
                  <AmountEdit
                    txn={txn}
                    onSave={(cents) => handleSave(txn.id, "amount", cents)}
                    onCancel={handleCancel}
                  />
                ) : (
                  format(txn.amount)
                )}
              </TableCell>

              {/* Type */}
              <TableCell
                className="text-[13px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "type")}
              >
                {activeCol === "type" ? (
                  <TypeEdit
                    value={txn.type}
                    onSave={(v) => handleSave(txn.id, "type", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  <TypeBadge type={txn.type} label={t(`table.types.${txn.type}` as const)} />
                )}
              </TableCell>

              {/* Account — selector for transfers, display for others */}
              <TableCell className="text-[13px] text-muted-foreground py-1" onClick={(e) => e.stopPropagation()}>
                {txn.type === "transfer" ? (
                  <div
                    className={`[&>div]:w-full [&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0 ${
                      // Unset counterpart → outline the dropdown so it's easy to
                      // spot in the preview that it still needs an account.
                      txn.targetAccountId
                        ? ""
                        : "[&_button:first-of-type]:border-amber-500/60 [&_button:first-of-type]:ring-1 [&_button:first-of-type]:ring-amber-500/40"
                    }`}
                  >
                    <AccountSelector
                      accounts={accounts}
                      value={txn.targetAccountId || ""}
                      onChange={(id) =>
                        onUpdateTransaction(txn.id, { targetAccountId: id })
                      }
                      placeholder={txn.amount < 0 ? t("table.toAccount") : t("table.fromAccount")}
                      includeUnset={!!txn.targetAccountId}
                      disableIds={[accountMapping[txn.sourceAccount] || txn.accountId].filter(Boolean)}
                    />
                  </div>
                ) : (
                  <MappedAccountCell
                    sourceAccount={txn.sourceAccount}
                    accounts={accounts}
                    accountMapping={accountMapping}
                    onOpenMapping={onOpenAccountMapping}
                    t={t}
                  />
                )}
              </TableCell>

              {/* Category (selector) */}
              <TableCell className="text-[13px] py-1" onClick={(e) => e.stopPropagation()}>
                <CategorySelector
                  categories={categories}
                  value={txn.categoryId || null}
                  onChange={(categoryId) =>
                    onUpdateTransaction(txn.id, {
                      categoryId: categoryId || "",
                      categoryConfidence: categoryId ? "high" : "",
                    })
                  }
                  placeholder={txn.type === "transfer" ? t("table.transferPlaceholder") : t("table.uncategorizedPlaceholder")}
                  includeUncategorized
                  suffix={txn.categoryConfidence ? (
                    <ConfidenceDot confidence={txn.categoryConfidence} t={t} />
                  ) : undefined}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Mapped Account Cell ──────────────────────────────────────────

/**
 * The ACCOUNT column for non-transfer rows shows where the row will actually
 * land: the mapped target account's name, or the imported name with a "new"
 * tag when merge would create it. The cell is the Map-accounts dialog's
 * trigger, but reads as quiet text — mapping is rarely what the user is here
 * for, and a button shape would impersonate the transfer rows' dropdowns. The
 * raw imported → target relationship lives in the dialog, not the cell.
 */
function MappedAccountCell({
  sourceAccount,
  accounts,
  accountMapping,
  onOpenMapping,
  t,
}: {
  sourceAccount: string;
  accounts: Account[];
  accountMapping: Record<string, string>;
  onOpenMapping: () => void;
  t: TFunction<["import", "common"]>;
}) {
  if (!sourceAccount) {
    return <span className="text-muted-foreground/40 italic">{t("table.noAccount")}</span>;
  }
  const targetId = accountMapping[sourceAccount];
  const target =
    targetId && targetId !== "__create__" ? accounts.find((a) => a.id === targetId) : undefined;

  return (
    <button
      type="button"
      onClick={onOpenMapping}
      className="group flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-left hover:text-foreground transition-colors"
    >
      <span className="truncate underline-offset-2 group-hover:underline">
        {target ? target.name : sourceAccount}
      </span>
      {!target && (
        <span className="shrink-0 rounded bg-brand/10 px-1 py-px text-[10px] font-medium text-brand">
          {t("table.newAccountTag")}
        </span>
      )}
    </button>
  );
}

// ── Type Badge ──────────────────────────────────────────────────

function TypeBadge({ type, label }: { type: string; label: string }) {
  const colors: Record<string, string> = {
    expense: "bg-amount-expense/10 text-amount-expense",
    income: "bg-amount-income/10 text-amount-income",
    transfer: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${colors[type] ?? colors.transfer}`}
    >
      {label}
    </span>
  );
}

// ── Confidence Dot ───────────────────────────────────────────────

function ConfidenceDot({
  confidence,
  t,
}: {
  confidence: string;
  t: TFunction<["import", "common"]>;
}) {
  const color =
    confidence === "high"
      ? "bg-amount-income"
      : "bg-amber-400";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
      title={t("table.confidenceTitle", { confidence })}
    />
  );
}
