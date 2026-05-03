import { useEffect, useMemo } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  filterTransactionsByDateRange,
  getPeriodSummary,
} from "@capybudget/core";
import type { DateRange } from "@capybudget/core";
import { useTransactions, useCategories, useAccounts } from "@/hooks/use-budget-data";
import { useAnalyticsStore, type PeriodType, type TabId } from "@/stores/analytics-store";
import { CategoryPanel } from "@/components/budget/category-panel";
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
  label: string;
  allowedPeriods: PeriodType[];
}

const TABS: TabDef[] = [
  { id: "spending", label: "Spending", allowedPeriods: ["month", "quarter", "year", "allTime", "custom"] },
  { id: "cashFlow", label: "Cash Flow", allowedPeriods: ["year", "allTime", "custom"] },
  { id: "netWorth", label: "Net Worth", allowedPeriods: ["year", "allTime", "custom"] },
  { id: "compare", label: "Compare", allowedPeriods: ["year", "allTime"] },
  { id: "merchants", label: "Merchants", allowedPeriods: ["month", "quarter", "year", "allTime"] },
  { id: "monthlyBudget", label: "Monthly Budget", allowedPeriods: ["month"] },
];

export function AnalyticsView() {
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
  const canGoBack = useAnalyticsStore((s) => s.canNavigateBack());
  const canGoForward = useAnalyticsStore((s) => s.canNavigateForward());

  const { dateRange, periodType } = tabState;

  // Update data bounds when transactions change
  useEffect(() => {
    if (transactions.length > 0) {
      updateDataBounds(transactions);
    }
  }, [transactions, updateDataBounds]);

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
        <div className="flex items-center -mb-px">
          <div className="flex gap-0 flex-1 min-w-0 overflow-x-auto">
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
                {tab.label}
              </button>
            ))}
          </div>

          {/* Category management gear */}
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Manage categories"
                />
              }
            >
              <Settings className="h-4 w-4" />
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Manage Categories</DialogTitle>
              </DialogHeader>
              <CategoryPanel categories={categories} />
            </DialogContent>
          </Dialog>
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
        />
        {activeTab !== "monthlyBudget" && <SummaryStrip summary={summary} />}
      </div>

      {/* Active tab content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {activeTab === "spending" && (
          <SpendingTab transactions={filtered} categories={categories} />
        )}
        {activeTab === "netWorth" && (
          <NetWorthTab accounts={accounts} transactions={transactions} dateRange={dateRange} />
        )}
        {activeTab === "cashFlow" && (
          <CashFlowTab transactions={transactions} dateRange={dateRange} />
        )}
        {activeTab === "compare" && (
          <CompareTab transactions={transactions} categories={categories} dateRange={dateRange} />
        )}
        {activeTab === "merchants" && (
          <MerchantsTab transactions={filtered} />
        )}
        {activeTab === "monthlyBudget" && (
          <MonthlyBudgetTab
            transactions={transactions}
            categories={categories}
            dateRange={dateRange}
          />
        )}
      </div>
    </div>
  );
}
