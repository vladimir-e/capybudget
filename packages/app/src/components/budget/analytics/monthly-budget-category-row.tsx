import { useEffect, useRef, useState } from "react";
import {
  parseMoney,
  centsToEditString,
} from "@capybudget/core";
import type { Category } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useFormatters } from "@/hooks/use-formatters";
import { useCategoryDisplayName } from "@/lib/display-names";
import { useSetCategoryAssigned } from "@/hooks/use-category-mutations";
import { toast } from "@/lib/toast";
import { TransactionsDrilldownLink } from "@/components/budget/transactions-drilldown-link";
import { BudgetBar } from "./budget-bar";
import type { BudgetRow } from "./monthly-budget-rows";

// ── Inline assigned input ────

interface AssignedInputProps {
  category: Category;
  row: BudgetRow;
}

/** Editable monthly target. Three resting states, all click-to-edit into the
 *  same `Editor`:
 *   - explicit budget   → the assigned amount.
 *   - implicit target   → the auto-derived amount + an "auto" tag, so the user
 *                         sees Capy's inferred number and can override it.
 *   - untargeted        → a quiet "set" affordance (no budget, no history).
 *  Empty input commits as `null` (back to auto/untargeted); `0` commits as an
 *  explicit zero target. Esc cancels, Enter or blur commits. */
function AssignedInput({ category, row }: AssignedInputProps) {
  const { money } = useFormatters();
  const { t } = useTranslation("analytics");
  const categoryDisplay = useCategoryDisplayName();
  // When not editing, the displayed value is derived directly from the props.
  // When editing, we mount a separate <Editor> with its own local state and
  // an unconditional auto-focus on mount. This sidesteps the "sync state on
  // prop change" problem and the React Compiler warning that comes with it.
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Editor
        category={category}
        onDone={() => setEditing(false)}
      />
    );
  }

  let display: React.ReactNode;
  let ariaLabel: string;
  if (row.assigned !== null) {
    display = <span className="tabular-nums">{money(row.assigned)}</span>;
    ariaLabel = t("budgetInput.editAria", { name: categoryDisplay(category.name) });
  } else if (row.isImplicit) {
    // AUTO is a prefix label pinned left while the amount stays pegged to the
    // column's right edge, so auto targets line up with explicit-budget rows.
    display = (
      <span className="flex w-full items-center justify-between gap-1.5">
        <span className="rounded-sm bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          {t("budgetInput.auto")}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {money(row.implicitTarget!)}
        </span>
      </span>
    );
    ariaLabel = t("budgetInput.setAutoAria", { name: categoryDisplay(category.name), amount: money(row.implicitTarget!) });
  } else {
    display = <span className="text-muted-foreground/60 italic">{t("budgetInput.set")}</span>;
    ariaLabel = t("budgetInput.setAria", { name: categoryDisplay(category.name) });
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-right text-sm w-full rounded px-2 py-1 hover:bg-accent transition-colors"
      aria-label={ariaLabel}
    >
      {display}
    </button>
  );
}

function Editor({ category, onDone }: { category: Category; onDone: () => void }) {
  const { symbol } = useFormatMoney();
  const { t } = useTranslation("analytics");
  const categoryDisplay = useCategoryDisplayName();
  const [value, setValue] = useState(() =>
    category.assigned === null ? "" : centsToEditString(category.assigned),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const setAssigned = useSetCategoryAssigned();

  // Auto-focus runs once when the editor mounts.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    const trimmed = value.trim();
    let next: number | null;
    if (trimmed === "") {
      next = null;
    } else {
      // parseMoney coerces unparseable input to 0; guard explicitly so
      // typing "twenty" doesn't silently track the category at zero.
      const numericPart = trimmed.replace(/[^0-9.-]/g, "");
      if (numericPart === "" || isNaN(parseFloat(numericPart))) {
        // Garbage input — bail without writing.
        onDone();
        return;
      }
      const cents = parseMoney(trimmed);
      if (cents < 0) {
        // Negative assigned doesn't make sense — bail without writing.
        onDone();
        return;
      }
      next = cents;
    }

    if (next === category.assigned) {
      onDone();
      return;
    }

    setAssigned.mutate(
      { categoryId: category.id, assigned: next },
      {
        onError: () => toast.error(t("budgetInput.updateError", { name: categoryDisplay(category.name) })),
      },
    );
    onDone();
  }

  return (
    <div className="flex items-center justify-end">
      {symbol && <span className="text-sm text-muted-foreground pr-0.5">{symbol}</span>}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        placeholder={t("budgetInput.placeholder")}
        className="h-7 bg-transparent border-0 border-b border-brand/40 rounded-none px-0.5 text-right text-sm tabular-nums focus:outline-none focus:ring-0 focus:border-brand/60 transition-colors"
        style={{ width: `${Math.max(value.length, 5) + 1}ch` }}
      />
    </div>
  );
}

// ── Category row ────

interface CategoryRowProps {
  category: Category;
  row: BudgetRow;
  referenceLabel: string;
  onDrilldown: (category: Category) => void;
}

export function CategoryRow({ category, row, referenceLabel, onDrilldown }: CategoryRowProps) {
  const { money } = useFormatters();
  const { t } = useTranslation("analytics");
  const categoryDisplay = useCategoryDisplayName();
  const { spent, effectiveTarget } = row;
  const targeted = effectiveTarget !== null;
  const hasSpent = spent > 0;
  // Remaining only exists when there's a target to count down from. Over-spend
  // renders as a signed negative ("-$X") in the expense token — the minus sign
  // carries the meaning, so it reads without relying on color alone.
  const remaining = targeted ? effectiveTarget - spent : null;
  const over = remaining !== null && remaining < 0;

  return (
    <div
      className={`grid grid-cols-[minmax(0,1.4fr)_140px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 py-2 rounded-md hover:bg-accent/40 transition-colors ${
        targeted ? "" : "opacity-70"
      }`}
    >
      {/* Name + dot — brand dot when Capy is tracking the category (explicit
       *  or implicit target), muted when there's no basis to track against. */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: targeted ? "var(--brand)" : "var(--muted-foreground)" }}
        />
        <span className="text-sm truncate">{categoryDisplay(category.name)}</span>
      </div>

      {/* Assigned / target (editable) */}
      <AssignedInput category={category} row={row} />

      {/* Spent — targeted rows always show the number (incl. $0.00).
       *  Untargeted rows show their spend if any, em-dash otherwise.
       *  Clickable when there's spending to show; opens the transactions
       *  browser pre-filtered to this category + month. */}
      {hasSpent ? (
        <div className="text-right text-sm tabular-nums">
          <TransactionsDrilldownLink
            onClick={() => onDrilldown(category)}
            ariaLabel={t("a11y.viewTransactionsAria", { name: categoryDisplay(category.name) })}
          >
            {money(spent)}
          </TransactionsDrilldownLink>
        </div>
      ) : (
        <span className="text-right text-sm tabular-nums">
          {targeted ? (
            money(spent)
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </span>
      )}

      {/* Zoned bar */}
      <div>
        <BudgetBar row={row} referenceLabel={referenceLabel} />
      </div>

      {/* Remaining — signed, so an overspend reads "-$X" in the expense token. */}
      <span
        className={`text-right text-sm tabular-nums ${
          over ? "text-amount-expense" : "text-foreground"
        }`}
      >
        {remaining === null ? (
          <span className="text-muted-foreground/50">—</span>
        ) : (
          money(remaining)
        )}
      </span>
    </div>
  );
}
