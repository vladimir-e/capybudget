/**
 * Format raw `getBudgetStats` output into the three pre-formatted lines
 * `buildContext` consumes. Returning undefined for an empty budget lets
 * the chat prompt skip the section entirely.
 *
 * Kept out of the chat prompt module so it stays free of `@capybudget/core`
 * runtime imports; kept out of `useCapySession` so the hook stays repo-free
 * and easy to test.
 */

import { formatMoney, getBudgetStats } from "@capybudget/core";
import type { Account, Category, Transaction } from "@capybudget/core";
import type { BudgetStatsBlock } from "@capybudget/intelligence";

export function formatBudgetStatsBlock(
  transactions: Transaction[],
  accounts: Account[],
  categories: Category[],
): BudgetStatsBlock | undefined {
  if (transactions.length === 0 && accounts.length === 0) return undefined;

  const stats = getBudgetStats(transactions, accounts, categories);
  const span = formatDateSpan(stats.earliestDate, stats.latestDate);
  const headline =
    `${formatCount(stats.transactionCount, "transaction")} ` +
    `across ${formatCount(stats.activeAccountCount, "account")}` +
    (span ? ` spanning ${span}` : "");

  const netWorth = `Net worth: ${formatMoney(stats.netWorth)}`;

  let topCategories: string | undefined;
  if (stats.topExpenseCategoriesYtd.length > 0) {
    const parts = stats.topExpenseCategoriesYtd.map(
      (c) => `${c.categoryName} (${formatMoney(c.amount)})`,
    );
    topCategories = `Top YTD expense categories: ${parts.join(", ")}`;
  }

  return { headline, netWorth, topCategories };
}

function formatCount(n: number, label: string): string {
  const plural = n === 1 ? label : `${label}s`;
  return `${n.toLocaleString("en-US")} ${plural}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateSpan(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return `${formatMonthYear(start)} – ${formatMonthYear(end)}`;
}

function formatMonthYear(ymd: string): string {
  const [y, m] = ymd.split("-");
  const monthIdx = Number(m) - 1;
  return `${MONTHS[monthIdx] ?? m} ${y}`;
}
