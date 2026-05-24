import { describe, it, expect, vi, afterEach } from "vitest";
import { buildContext, SYSTEM_PROMPT } from "./chat";
import { SPECS, SPEC_FILENAMES } from "../specs.generated";

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

  it("omits the [Budget stats] block when no stats are supplied", () => {
    const result = buildContext({ budgetName: "Test" });
    expect(result).not.toContain("[Budget stats]");
  });

  it("renders the [Budget stats] block between [Context] and [User message]", () => {
    const result = buildContext({
      budgetName: "Test",
      stats: {
        headline: "1,247 transactions across 8 accounts spanning Jan 2020 – May 2026",
        netWorth: "Net worth: $123,456",
        topCategories: "Top YTD expense categories: Groceries ($4,231)",
      },
    });
    expect(result).toContain("[Budget stats]");
    expect(result).toContain("1,247 transactions across 8 accounts");
    expect(result).toContain("Net worth: $123,456");
    expect(result).toContain("Top YTD expense categories: Groceries ($4,231)");

    const statsIdx = result.indexOf("[Budget stats]");
    const userIdx = result.indexOf("[User message]");
    expect(statsIdx).toBeGreaterThan(result.indexOf("[Context]"));
    expect(statsIdx).toBeLessThan(userIdx);
  });

  it("places [Budget stats] after Budget folder and before [User message]", () => {
    const result = buildContext({
      budgetName: "Test",
      budgetPath: "/path/to/budget",
      stats: {
        headline: "100 transactions across 2 accounts spanning Jan 2026 – May 2026",
      },
    });
    const folderIdx = result.indexOf("Budget folder:");
    const statsIdx = result.indexOf("[Budget stats]");
    const userIdx = result.indexOf("[User message]");
    expect(folderIdx).toBeGreaterThan(-1);
    expect(statsIdx).toBeGreaterThan(folderIdx);
    expect(statsIdx).toBeLessThan(userIdx);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("embeds the full DATA_MODEL.md", () => {
    expect(SYSTEM_PROMPT).toContain(SPECS["DATA_MODEL.md"]);
  });

  it("embeds the full PRODUCT.md", () => {
    expect(SYSTEM_PROMPT).toContain(SPECS["PRODUCT.md"]);
  });

  it("tells the model about read_spec and lists the available files", () => {
    expect(SYSTEM_PROMPT).toContain("read_spec");
    for (const name of SPEC_FILENAMES) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("mentions search_merchants so chat can answer merchant-by-name questions", () => {
    expect(SYSTEM_PROMPT).toContain("search_merchants");
  });

  it("acknowledges the import-side read tools available in the chat session", () => {
    expect(SYSTEM_PROMPT).toContain("read_import_file");
    expect(SYSTEM_PROMPT).toContain("list_import_files");
  });

  it("does not promote the import-flow tools as chat actions", () => {
    // The chat shouldn't initiate normalization or enrichment — those
    // belong to the import screen's dedicated session. We still want to
    // surface read-only awareness without prompting the model to drive
    // the pipeline.
    expect(SYSTEM_PROMPT).not.toContain("analyze_csv");
    expect(SYSTEM_PROMPT).not.toContain("transform_csv");
    expect(SYSTEM_PROMPT).not.toContain("auto_enrich");
  });
});
