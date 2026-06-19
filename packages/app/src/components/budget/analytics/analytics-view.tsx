import { useEffect, useMemo } from "react";
import {
  filterTransactionsByDateRange,
  getPeriodSummary,
} from "@capybudget/core";
import type { DateRange } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useTransactions, useCategories, useAccounts } from "@/hooks/use-budget-data";
import { useAnalyticsStore, type PeriodType, type TabId } from "@/stores/analytics-store";
import { DateRangeNav } from "./date-range-nav";
import { SummaryStrip } from "./summary-strip";
import { SpendingTab } from "./spending-tab";
import { NetWorthTab } from "./net-worth-tab";
import { CashFlowTab } from "./cash-flow-tab";
import { CompareTab } from "./compare-tab";
import { MerchantsTab } from "./merchants-tab";
import { MonthlyBudgetTab } from "./monthly-budget-tab";

// ── Tab definitions ──

interface TabDef {
  id: TabId;
  allowedPeriods: PeriodType[];
}

const TABS: TabDef[] = [
  { id: "spending", allowedPeriods: ["month", "quarter", "year", "allTime", "custom"] },
  { id: "cashFlow", allowedPeriods: ["year", "allTime", "custom"] },
  { id: "netWorth", allowedPeriods: ["year", "allTime", "custom"] },
  { id: "compare", allowedPeriods: ["year", "allTime", "custom"] },
  { id: "merchants", allowedPeriods: ["month", "quarter", "year", "allTime"] },
  { id: "monthlyBudget", allowedPeriods: ["month"] },
];

export function AnalyticsView() {
  const { t } = useTranslation("analytics");
  // Data hooks
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();

  // Per-tab store
  const activeTab = useAnalyticsStore((s) => s.activeTab);
  const tabState = useAnalyticsStore((s) => s.tabs[s.activeTab]);
  const setActiveTab = useAnalyticsStore((s) => s.setActiveTab);
  const setPeriod = useAnalyticsStore((s) => s.setPeriod);
  const navigateForward = useAnalyticsStore((s) => s.navigateForward);
  const navigateBack = useAnalyticsStore((s) => s.navigateBack);
  const setAllTimeRange = useAnalyticsStore((s) => s.setAllTimeRange);
  const updateDataBounds = useAnalyticsStore((s) => s.updateDataBounds);
  const dataBounds = useAnalyticsStore((s) => s.dataBounds);
  const canGoBack = useAnalyticsStore((s) => s.canNavigateBack());
  const canGoForward = useAnalyticsStore((s) => s.canNavigateForward());

  const { dateRange, periodType } = tabState;

  // Update data bounds when transactions change
  useEffect(() => {
    if (transactions.length > 0) {
      updateDataBounds(transactions);
    }
  }, [transactions, updateDataBounds]);

  // Whole-budget signal — distinguishes a brand-new budget (forward-looking
  // copy) from a period that simply has no data (period-scoped copy). Tabs
  // can't derive this themselves: they receive period-filtered slices.
  const hasAnyTransactions = transactions.length > 0;

  // Filtered transactions
  const filtered = useMemo(
    () => filterTransactionsByDateRange(transactions, dateRange),
    [transactions, dateRange],
  );

  // Summary
  const summary = useMemo(() => getPeriodSummary(filtered), [filtered]);

  // Current tab definition
  const currentTab = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  // Handle period change
  function handlePeriodChange(type: PeriodType) {
    if (type === "allTime") {
      setAllTimeRange(transactions);
    } else {
      setPeriod(type);
    }
  }

  // Handle custom range
  function handleCustomRange(range: DateRange) {
    setPeriod("custom", range);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="border-b px-6">
        <div className="flex gap-0 -mb-px min-w-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`tabs.${tab.id}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Date range + summary. Monthly Budget renders its own KPI strip and
       *  doesn't need the global income/expense/net summary. */}
      <div className="px-6 pt-4 space-y-4">
        <DateRangeNav
          periodType={periodType}
          dateRange={dateRange}
          allowedPeriods={currentTab.allowedPeriods}
          onPeriodChange={handlePeriodChange}
          onBack={navigateBack}
          onForward={navigateForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onCustomRange={handleCustomRange}
          dataBounds={dataBounds}
        />
        {activeTab !== "monthlyBudget" && <SummaryStrip summary={summary} />}
      </div>

      {/* Monthly Budget pads itself so its sticky header pins flush; every
       *  other tab gets the gap below the summary strip here. */}
      <div className={`flex-1 overflow-y-auto px-6 pb-4 ${activeTab === "monthlyBudget" ? "" : "pt-4"}`}>
        {activeTab === "spending" && (
          <SpendingTab
            transactions={filtered}
            categories={categories}
            dateRange={dateRange}
            periodType={periodType}
            hasAnyTransactions={hasAnyTransactions}
          />
        )}
        {activeTab === "netWorth" && (
          <NetWorthTab
            accounts={accounts}
            transactions={transactions}
            dateRange={dateRange}
            hasAnyTransactions={hasAnyTransactions}
          />
        )}
        {activeTab === "cashFlow" && (
          <CashFlowTab
            transactions={transactions}
            dateRange={dateRange}
            hasAnyTransactions={hasAnyTransactions}
          />
        )}
        {activeTab === "compare" && (
          <CompareTab
            transactions={transactions}
            categories={categories}
            dateRange={dateRange}
            hasAnyTransactions={hasAnyTransactions}
          />
        )}
        {activeTab === "merchants" && (
          <MerchantsTab
            transactions={filtered}
            dateRange={dateRange}
            periodType={periodType}
            hasAnyTransactions={hasAnyTransactions}
          />
        )}
        {activeTab === "monthlyBudget" && (
          <MonthlyBudgetTab
            transactions={transactions}
            categories={categories}
            dateRange={dateRange}
            hasAnyTransactions={hasAnyTransactions}
          />
        )}
      </div>
    </div>
  );
}
