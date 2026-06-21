import { describe, it, expect } from "vitest";
import type { Account } from "@capybudget/core";
import { computeToggleExclusions } from "./net-worth-filter-utils";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc",
    name: "Test",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    currency: "USD",
    ...overrides,
  };
}

describe("computeToggleExclusions", () => {
  it("toggling an unchecked box adds its id to exclusions", () => {
    const accounts = [
      makeAccount({ id: "a", excludeFromNetWorth: false }),
      makeAccount({ id: "b", excludeFromNetWorth: true }),
      makeAccount({ id: "c", excludeFromNetWorth: false }),
    ];
    // Unchecking "a" — i.e. nextIncluded=false — adds "a" to exclusions while
    // leaving "b" intact.
    const next = computeToggleExclusions(accounts, "a", false);
    expect(next).toEqual(new Set(["a", "b"]));
  });

  it("toggling a checked box removes its id, leaves other excluded ids intact", () => {
    const accounts = [
      makeAccount({ id: "a", excludeFromNetWorth: true }),
      makeAccount({ id: "b", excludeFromNetWorth: true }),
      makeAccount({ id: "c", excludeFromNetWorth: false }),
    ];
    // Checking "a" back on (nextIncluded=true) removes it from exclusions; "b" stays.
    const next = computeToggleExclusions(accounts, "a", true);
    expect(next).toEqual(new Set(["b"]));
  });

  it("toggling the only-checked box leaves the others (already excluded) untouched", () => {
    // Only "c" is currently checked (included); "a" and "b" are unchecked (excluded).
    const accounts = [
      makeAccount({ id: "a", excludeFromNetWorth: true }),
      makeAccount({ id: "b", excludeFromNetWorth: true }),
      makeAccount({ id: "c", excludeFromNetWorth: false }),
    ];
    // User unchecks "c" — it should join "a" and "b" in the excluded set, with
    // "a" and "b" still excluded.
    const next = computeToggleExclusions(accounts, "c", false);
    expect(next).toEqual(new Set(["a", "b", "c"]));
  });
});
