import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RecentBudget } from "@capybudget/core";
import type { SortConfig } from "@/lib/filter-transactions";

const DEFAULT_SORT: SortConfig = { column: "date", direction: "desc" };

interface AppState {
  recentBudgets: RecentBudget[];
  addRecentBudget: (path: string, name: string) => void;
  removeRecentBudget: (path: string) => void;

  sortPreferences: Record<string, SortConfig>;
  setSortPreference: (viewKey: string, sort: SortConfig) => void;
  getSortPreference: (viewKey: string) => SortConfig;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      recentBudgets: [],

      addRecentBudget: (path, name) =>
        set((state) => {
          const filtered = state.recentBudgets.filter((b) => b.path !== path);
          return {
            recentBudgets: [
              { path, name, lastOpened: new Date().toISOString() },
              ...filtered,
            ].slice(0, 10),
          };
        }),

      removeRecentBudget: (path) =>
        set((state) => ({
          recentBudgets: state.recentBudgets.filter((b) => b.path !== path),
        })),

      sortPreferences: {},

      setSortPreference: (viewKey, sort) =>
        set((state) => ({
          sortPreferences: { ...state.sortPreferences, [viewKey]: sort },
        })),

      getSortPreference: (viewKey) =>
        get().sortPreferences[viewKey] ?? DEFAULT_SORT,
    }),
    { name: "capybudget-app" },
  ),
);
