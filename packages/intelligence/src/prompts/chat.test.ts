import { describe, it, expect, vi, afterEach } from "vitest";
import { buildContext, SYSTEM_PROMPT } from "./chat";
import { APP_KNOWLEDGE } from "./app-knowledge";
import { APP_MAP } from "./app-map";
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
});

describe("SYSTEM_PROMPT", () => {
  it("embeds the shared app-knowledge brief", () => {
    expect(SYSTEM_PROMPT).toContain(APP_KNOWLEDGE);
  });

  it("embeds the app map so wayfinding questions get the real layout", () => {
    expect(SYSTEM_PROMPT).toContain(APP_MAP);
  });

  it("reconciles the act-directly stance for wayfinding questions", () => {
    // The shared brief says to act rather than tell the user where to click;
    // chat carves out an exception so "where is X" gets the path, not an
    // improvised location.
    expect(SYSTEM_PROMPT).toContain("where");
    expect(SYSTEM_PROMPT).toContain("never improvise a location");
  });

  it("does not embed the full DATA_MODEL.md or PRODUCT.md (those move to read_spec)", () => {
    // The heavy specs are reachable via read_spec, not baked into every
    // session. Guards against regressing the token-floor cleanup.
    expect(SYSTEM_PROMPT).not.toContain(SPECS["DATA_MODEL.md"]);
    expect(SYSTEM_PROMPT).not.toContain(SPECS["PRODUCT.md"]);
  });

  it("tells the model about read_spec and lists the available files", () => {
    expect(SYSTEM_PROMPT).toContain("read_spec");
    for (const name of SPEC_FILENAMES) {
      expect(SYSTEM_PROMPT).toContain(name);
    }
  });

  it("mentions search_transactions so chat can answer merchant-by-name questions", () => {
    expect(SYSTEM_PROMPT).toContain("search_transactions");
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
