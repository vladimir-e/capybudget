import { describe, it, expect, vi, afterEach } from "vitest";
import { buildContext, buildSystemPrompt } from "./chat";
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

describe("buildSystemPrompt", () => {
  const SYSTEM_PROMPT = buildSystemPrompt("USD");

  it("embeds the shared app-knowledge brief", () => {
    expect(SYSTEM_PROMPT).toContain(APP_KNOWLEDGE);
  });

  it("embeds the app map so wayfinding questions get the real layout", () => {
    expect(SYSTEM_PROMPT).toContain(APP_MAP);
  });

  it("reconciles the act-directly stance for wayfinding questions", () => {
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

  it("routes attached files through the start_import on-ramp, not direct inserts", () => {
    expect(SYSTEM_PROMPT).toContain("start_import");
  });

  it("formats the money examples in the budget's currency", () => {
    expect(buildSystemPrompt("USD")).toContain("$12.50");
    const eur = buildSystemPrompt("EUR");
    expect(eur).toContain("€12.50");
    expect(eur).toContain("The budget's currency is EUR");
    expect(eur).not.toContain("$12.50");
  });

  it("uses the currency's default convention, not a user override", () => {
    // RUB's default is zero-decimal with a trailing symbol — Capy formats in
    // that convention, independent of any UI format the user picked.
    const rub = buildSystemPrompt("RUB");
    expect(rub).toContain("13 ₽"); // 1250 cents → 12.5 → 13 at 0 decimals, symbol after
    expect(rub).not.toContain("₽12");
  });
});
