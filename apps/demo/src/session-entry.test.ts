import { beforeEach, describe, expect, it, vi } from "vitest";

// The flag is module-scoped, so each test imports a fresh copy to assert the
// initial state — mirroring the hard-reload reset the module relies on.
async function freshModule() {
  vi.resetModules();
  return import("./session-entry");
}

describe("session-entry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("starts false on a fresh load", async () => {
    const { hasEnteredScenario } = await freshModule();
    expect(hasEnteredScenario()).toBe(false);
  });

  it("flips to true after markScenarioEntered", async () => {
    const { hasEnteredScenario, markScenarioEntered } = await freshModule();
    expect(hasEnteredScenario()).toBe(false);
    markScenarioEntered();
    expect(hasEnteredScenario()).toBe(true);
  });
});
