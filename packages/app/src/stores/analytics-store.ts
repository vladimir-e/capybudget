import { create } from "zustand";
import type { DateRange } from "@capybudget/core";

export type PeriodType = "month" | "quarter" | "year" | "allTime" | "custom";

export const TAB_IDS = [
  "spending",
  "netWorth",
  "cashFlow",
  "compare",
  "merchants",
  "monthlyBudget",
] as const;

export type TabId = (typeof TAB_IDS)[number];

interface TabState {
  periodType: PeriodType;
  dateRange: DateRange;
}

// The active tab lives in the URL (?tab=…), so it's the caller's job to pass it
// in; the store owns only per-tab period/date-range state.
interface AnalyticsState {
  tabs: Record<TabId, TabState>;
  dataBounds: DateRange | null; // earliest/latest transaction dates
  netWorthExcludedIds: Set<string>;
  setNetWorthExcludedIds: (ids: Set<string>) => void;
  setPeriod: (tab: TabId, type: PeriodType, range?: DateRange) => void;
  navigateForward: (tab: TabId) => void;
  navigateBack: (tab: TabId) => void;
  setAllTimeRange: (tab: TabId, transactions: { datetime: string }[]) => void;
  updateDataBounds: (transactions: { datetime: string }[]) => void;
  canNavigateBack: (tab: TabId) => boolean;
  canNavigateForward: (tab: TabId) => boolean;
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

function defaultRangeForPeriod(type: PeriodType): DateRange {
  return rangeForPeriodContaining(new Date(), type);
}

function rangeForPeriodContaining(date: Date, periodType: PeriodType): DateRange {
  switch (periodType) {
    case "month":
      return {
        start: new Date(date.getFullYear(), date.getMonth(), 1),
        end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
      };
    case "quarter": {
      const q = Math.floor(date.getMonth() / 3) * 3;
      return {
        start: new Date(date.getFullYear(), q, 1),
        end: new Date(date.getFullYear(), q + 3, 1),
      };
    }
    case "year":
      return {
        start: new Date(date.getFullYear(), 0, 1),
        end: new Date(date.getFullYear() + 1, 0, 1),
      };
    default:
      return {
        start: new Date(date.getFullYear(), date.getMonth(), 1),
        end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
      };
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

function computeBounds(transactions: { datetime: string }[]): DateRange | null {
  if (transactions.length === 0) return null;
  const dates = transactions.map((t) => new Date(t.datetime).getTime());
  const earliest = new Date(Math.min(...dates));
  const latest = new Date(Math.max(...dates));
  return {
    start: new Date(earliest.getFullYear(), earliest.getMonth(), 1),
    end: new Date(latest.getFullYear(), latest.getMonth() + 1, 1),
  };
}

function computeAllTimeRange(transactions: { datetime: string }[]): DateRange {
  return computeBounds(transactions) ?? getCurrentMonthRange();
}

const DEFAULT_TABS: Record<TabId, TabState> = {
  spending: { periodType: "month", dateRange: getCurrentMonthRange() },
  netWorth: { periodType: "allTime", dateRange: getCurrentYearRange() }, // placeholder until data loads
  cashFlow: { periodType: "year", dateRange: getCurrentYearRange() },
  compare: { periodType: "allTime", dateRange: getCurrentYearRange() },
  merchants: { periodType: "allTime", dateRange: getCurrentYearRange() },
  monthlyBudget: { periodType: "month", dateRange: getCurrentMonthRange() },
};

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  tabs: { ...DEFAULT_TABS },
  dataBounds: null,
  netWorthExcludedIds: new Set(),

  setNetWorthExcludedIds: (ids) => set({ netWorthExcludedIds: ids }),

  setPeriod: (tab, type, range) => {
    const { tabs } = get();
    const dateRange = range ?? defaultRangeForPeriod(type);
    set({
      tabs: { ...tabs, [tab]: { periodType: type, dateRange } },
    });
  },

  navigateForward: (tab) => {
    const { tabs } = get();
    const state = tabs[tab];
    if (state.periodType === "allTime") return;
    if (!get().canNavigateForward(tab)) return;
    set({
      tabs: { ...tabs, [tab]: { ...state, dateRange: shiftRange(state.dateRange, state.periodType, 1) } },
    });
  },

  navigateBack: (tab) => {
    const { tabs } = get();
    const state = tabs[tab];
    if (state.periodType === "allTime") return;
    if (!get().canNavigateBack(tab)) return;
    set({
      tabs: { ...tabs, [tab]: { ...state, dateRange: shiftRange(state.dateRange, state.periodType, -1) } },
    });
  },

  canNavigateBack: (tab) => {
    const { tabs, dataBounds } = get();
    const state = tabs[tab];
    if (state.periodType === "allTime" || !dataBounds) return false;
    return state.dateRange.start.getTime() > dataBounds.start.getTime();
  },

  canNavigateForward: (tab) => {
    const { tabs, dataBounds } = get();
    const state = tabs[tab];
    if (state.periodType === "allTime" || !dataBounds) return false;
    if (tab === "monthlyBudget") {
      const now = new Date();
      return state.dateRange.start.getTime() < new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    }
    return state.dateRange.end.getTime() < dataBounds.end.getTime();
  },

  setAllTimeRange: (tab, transactions) => {
    const { tabs } = get();
    const range = computeAllTimeRange(transactions);
    set({
      tabs: { ...tabs, [tab]: { periodType: "allTime", dateRange: range } },
    });
  },

  updateDataBounds: (transactions) => {
    const bounds = computeBounds(transactions);
    const { tabs } = get();
    const updates: Partial<Record<TabId, TabState>> = {};

    if (bounds) {
      const latestDate = new Date(bounds.end);
      latestDate.setMonth(latestDate.getMonth() - 1);

      for (const [id, tab] of Object.entries(tabs) as [TabId, TabState][]) {
        if (tab.periodType === "allTime") {
          updates[id as TabId] = { periodType: "allTime", dateRange: bounds };
        } else if (id !== "monthlyBudget" && tab.dateRange.start.getTime() >= bounds.end.getTime()) {
          updates[id as TabId] = { ...tab, dateRange: rangeForPeriodContaining(latestDate, tab.periodType) };
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      set({ dataBounds: bounds, tabs: { ...tabs, ...updates } });
    } else {
      set({ dataBounds: bounds });
    }
  },
}));
