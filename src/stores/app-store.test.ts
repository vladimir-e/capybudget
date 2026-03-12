import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAppStore } from "@/stores/app-store";

describe("app-store", () => {
  beforeEach(() => {
    // Reset to initial state before each test
    useAppStore.setState({
      recentBudgets: [],
      sortPreferences: {},
    });
  });

  describe("recentBudgets", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("starts with empty list", () => {
      expect(useAppStore.getState().recentBudgets).toEqual([]);
    });

    it("adds a recent budget", () => {
      useAppStore.getState().addRecentBudget("/path/to/budget", "My Budget");
      const budgets = useAppStore.getState().recentBudgets;
      expect(budgets).toHaveLength(1);
      expect(budgets[0].path).toBe("/path/to/budget");
      expect(budgets[0].name).toBe("My Budget");
      expect(budgets[0].lastOpened).toBeTruthy();
    });

    it("moves re-opened budget to the top", () => {
      useAppStore.getState().addRecentBudget("/first", "First");
      useAppStore.getState().addRecentBudget("/second", "Second");
      useAppStore.getState().addRecentBudget("/first", "First");

      const budgets = useAppStore.getState().recentBudgets;
      expect(budgets).toHaveLength(2);
      expect(budgets[0].path).toBe("/first");
      expect(budgets[1].path).toBe("/second");
    });

    it("caps at 10 entries", () => {
      for (let i = 0; i < 12; i++) {
        useAppStore.getState().addRecentBudget(`/budget-${i}`, `Budget ${i}`);
      }
      expect(useAppStore.getState().recentBudgets).toHaveLength(10);
    });

    it("keeps newest budget first when capping", () => {
      for (let i = 0; i < 12; i++) {
        useAppStore.getState().addRecentBudget(`/budget-${i}`, `Budget ${i}`);
      }
      expect(useAppStore.getState().recentBudgets[0].path).toBe("/budget-11");
    });

    it("removes a budget by path", () => {
      useAppStore.getState().addRecentBudget("/keep", "Keep");
      useAppStore.getState().addRecentBudget("/remove", "Remove");

      useAppStore.getState().removeRecentBudget("/remove");
      const budgets = useAppStore.getState().recentBudgets;
      expect(budgets).toHaveLength(1);
      expect(budgets[0].path).toBe("/keep");
    });

    it("remove is safe when path doesn't exist", () => {
      useAppStore.getState().addRecentBudget("/keep", "Keep");
      useAppStore.getState().removeRecentBudget("/nonexistent");
      expect(useAppStore.getState().recentBudgets).toHaveLength(1);
    });

    it("updates lastOpened when re-adding", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01"));
      useAppStore.getState().addRecentBudget("/budget", "Budget");
      const first = useAppStore.getState().recentBudgets[0].lastOpened;

      vi.setSystemTime(new Date("2026-03-01"));
      useAppStore.getState().addRecentBudget("/budget", "Budget");
      const second = useAppStore.getState().recentBudgets[0].lastOpened;

      expect(second).not.toBe(first);
    });
  });

  describe("sortPreferences", () => {
    it("returns default sort when no preference set", () => {
      const sort = useAppStore.getState().getSortPreference("all");
      expect(sort).toEqual({ column: "date", direction: "desc" });
    });

    it("stores and retrieves sort preference", () => {
      useAppStore.getState().setSortPreference("all", { column: "amount", direction: "asc" });
      expect(useAppStore.getState().getSortPreference("all")).toEqual({
        column: "amount",
        direction: "asc",
      });
    });

    it("maintains separate preferences per view key", () => {
      useAppStore.getState().setSortPreference("all", { column: "amount", direction: "asc" });
      useAppStore.getState().setSortPreference("acc-1", { column: "merchant", direction: "desc" });

      expect(useAppStore.getState().getSortPreference("all").column).toBe("amount");
      expect(useAppStore.getState().getSortPreference("acc-1").column).toBe("merchant");
    });

    it("overrides previous preference for same key", () => {
      useAppStore.getState().setSortPreference("all", { column: "date", direction: "asc" });
      useAppStore.getState().setSortPreference("all", { column: "merchant", direction: "desc" });

      expect(useAppStore.getState().getSortPreference("all")).toEqual({
        column: "merchant",
        direction: "desc",
      });
    });

    it("falls back to default for unknown keys", () => {
      useAppStore.getState().setSortPreference("all", { column: "amount", direction: "asc" });
      expect(useAppStore.getState().getSortPreference("unknown")).toEqual({
        column: "date",
        direction: "desc",
      });
    });
  });
});
