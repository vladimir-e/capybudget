import { describe, it, expect, vi, afterEach } from "vitest";
import { buildContext } from "@/services/capy-prompt";

describe("buildContext", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes the budget name", () => {
    const result = buildContext({ budgetName: "Family Budget 2026" });
    expect(result).toContain("Budget: Family Budget 2026");
  });

  it("includes a formatted date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00Z"));

    const result = buildContext({ budgetName: "Test" });
    // en-US long format: "March 13, 2026"
    expect(result).toContain("Date: March 13, 2026");
  });

  it("includes [Context] marker", () => {
    const result = buildContext({ budgetName: "My Budget" });
    expect(result).toContain("[Context]");
  });

  it("includes [User message] marker", () => {
    const result = buildContext({ budgetName: "My Budget" });
    expect(result).toContain("[User message]");
  });

  it("[Context] appears before [User message]", () => {
    const result = buildContext({ budgetName: "My Budget" });
    const contextIndex = result.indexOf("[Context]");
    const userIndex = result.indexOf("[User message]");
    expect(contextIndex).toBeLessThan(userIndex);
  });

  it("budget name and date appear between [Context] and [User message]", () => {
    const result = buildContext({ budgetName: "Savings Tracker" });
    const contextIndex = result.indexOf("[Context]");
    const userIndex = result.indexOf("[User message]");
    const budgetIndex = result.indexOf("Budget: Savings Tracker");
    const dateIndex = result.indexOf("Date:");

    expect(budgetIndex).toBeGreaterThan(contextIndex);
    expect(budgetIndex).toBeLessThan(userIndex);
    expect(dateIndex).toBeGreaterThan(contextIndex);
    expect(dateIndex).toBeLessThan(userIndex);
  });
});
