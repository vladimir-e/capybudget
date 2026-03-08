import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RecentBudget } from "@/lib/types";

interface AppState {
  recentBudgets: RecentBudget[];
  addRecentBudget: (path: string, name: string) => void;
  removeRecentBudget: (path: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
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
    }),
    { name: "capybudget-app" },
  ),
);
