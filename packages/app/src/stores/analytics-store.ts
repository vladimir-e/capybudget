import { create } from "zustand";
import type { DateRange } from "@capybudget/core";

export type PeriodType = "month" | "quarter" | "year" | "allTime" | "custom";

export type TabId = "spending" | "netWorth" | "cashFlow" | "trends" | "merchants" | "monthlyBudget";

interface TabState {
  periodType: PeriodType;
  dateRange: DateRange;
}

interface AnalyticsState {
  activeTab: TabId;
  tabs: Record<TabId, TabState>;
  setActiveTab: (tab: TabId) => void;
  setPeriod: (type: PeriodType, range?: DateRange) => void;
  navigateForward: () => void;
  navigateBack: () => void;
  setAllTimeRange: (transactions: { datetime: string }[]) => void;
}

function getCurrentMonthRange(): DateRange {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

function getCurrentYearRange(): DateRange {
  const now = new Date();
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear() + 1, 0, 1),
  };
}

function getCurrentQuarterRange(): DateRange {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) * 3;
  return {
    start: new Date(now.getFullYear(), q, 1),
    end: new Date(now.getFullYear(), q + 3, 1),
  };
}

function defaultRangeForPeriod(type: PeriodType): DateRange {
  switch (type) {
    case "month": return getCurrentMonthRange();
    case "quarter": return getCurrentQuarterRange();
    case "year": return getCurrentYearRange();
    default: return getCurrentMonthRange();
  }
}

function shiftRange(range: DateRange, periodType: PeriodType, delta: number): DateRange {
  const start = new Date(range.start);
  const end = new Date(range.end);

  switch (periodType) {
    case "month":
      start.setMonth(start.getMonth() + delta);
      end.setMonth(end.getMonth() + delta);
      break;
    case "quarter":
      start.setMonth(start.getMonth() + delta * 3);
      end.setMonth(end.getMonth() + delta * 3);
      break;
    case "year":
      start.setFullYear(start.getFullYear() + delta);
      end.setFullYear(end.getFullYear() + delta);
      break;
    case "custom": {
      const durationMs = range.end.getTime() - range.start.getTime();
      const shift = durationMs * delta;
      return {
        start: new Date(start.getTime() + shift),
        end: new Date(end.getTime() + shift),
      };
    }
    case "allTime":
      return range;
  }

  return { start, end };
}

const DEFAULT_TABS: Record<TabId, TabState> = {
  spending: { periodType: "month", dateRange: getCurrentMonthRange() },
  netWorth: { periodType: "year", dateRange: getCurrentYearRange() },
  cashFlow: { periodType: "year", dateRange: getCurrentYearRange() },
  trends: { periodType: "year", dateRange: getCurrentYearRange() },
  merchants: { periodType: "month", dateRange: getCurrentMonthRange() },
  monthlyBudget: { periodType: "month", dateRange: getCurrentMonthRange() },
};

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  activeTab: "spending",
  tabs: { ...DEFAULT_TABS },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setPeriod: (type, range) => {
    const { activeTab, tabs } = get();
    const dateRange = range ?? defaultRangeForPeriod(type);
    set({
      tabs: { ...tabs, [activeTab]: { periodType: type, dateRange } },
    });
  },

  navigateForward: () => {
    const { activeTab, tabs } = get();
    const tab = tabs[activeTab];
    if (tab.periodType === "allTime") return;
    set({
      tabs: { ...tabs, [activeTab]: { ...tab, dateRange: shiftRange(tab.dateRange, tab.periodType, 1) } },
    });
  },

  navigateBack: () => {
    const { activeTab, tabs } = get();
    const tab = tabs[activeTab];
    if (tab.periodType === "allTime") return;
    set({
      tabs: { ...tabs, [activeTab]: { ...tab, dateRange: shiftRange(tab.dateRange, tab.periodType, -1) } },
    });
  },

  setAllTimeRange: (transactions) => {
    const { activeTab, tabs } = get();
    if (transactions.length === 0) {
      set({
        tabs: { ...tabs, [activeTab]: { periodType: "allTime", dateRange: getCurrentMonthRange() } },
      });
      return;
    }
    const dates = transactions.map((t) => new Date(t.datetime).getTime());
    const earliest = new Date(Math.min(...dates));
    const latest = new Date(Math.max(...dates));
    set({
      tabs: {
        ...tabs,
        [activeTab]: {
          periodType: "allTime",
          dateRange: {
            start: new Date(earliest.getFullYear(), earliest.getMonth(), 1),
            end: new Date(latest.getFullYear(), latest.getMonth() + 1, 1),
          },
        },
      },
    });
  },
}));
