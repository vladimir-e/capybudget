import { describe, it, expect } from "vitest";
import type { Account } from "@capybudget/core";
import {
  computeIncludedIds,
  toggleAccountInclusion,
  setInclusionForIds,
} from "./net-worth-account-filter-utils";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc",
    name: "Test",
    type: "checking",
    archived: false,
    excludeFromNetWorth: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const accounts = [
  makeAccount({ id: "a" }),
  makeAccount({ id: "b" }),
  makeAccount({ id: "c" }),
];

describe("computeIncludedIds", () => {
  it("includes every account when nothing is excluded", () => {
    expect(computeIncludedIds(accounts, new Set())).toEqual(new Set(["a", "b", "c"]));
  });

  it("is all accounts minus the excluded set", () => {
    expect(computeIncludedIds(accounts, new Set(["b"]))).toEqual(new Set(["a", "c"]));
  });

  it("ignores a stale excluded id with no matching account", () => {
    expect(computeIncludedIds(accounts, new Set(["gone"]))).toEqual(
      new Set(["a", "b", "c"]),
    );
  });
});

describe("toggleAccountInclusion", () => {
  it("toggling an account off adds its id to the excluded set", () => {
    expect(toggleAccountInclusion("a", false, new Set())).toEqual(new Set(["a"]));
  });

  it("toggling an account on removes its id, leaves other excluded ids intact", () => {
    expect(toggleAccountInclusion("a", true, new Set(["a", "b"]))).toEqual(
      new Set(["b"]),
    );
  });

  it("does not mutate the input set", () => {
    const excluded = new Set(["b"]);
    toggleAccountInclusion("a", false, excluded);
    expect(excluded).toEqual(new Set(["b"]));
  });
});

describe("setInclusionForIds", () => {
  it("select-all over a group clears those ids from the excluded set", () => {
    expect(setInclusionForIds(["a", "b"], true, new Set(["a", "b", "c"]))).toEqual(
      new Set(["c"]),
    );
  });

  it("clear-all over every id excludes them all", () => {
    expect(setInclusionForIds(["a", "b", "c"], false, new Set())).toEqual(
      new Set(["a", "b", "c"]),
    );
  });

  it("does not mutate the input set", () => {
    const excluded = new Set(["c"]);
    setInclusionForIds(["a", "b"], false, excluded);
    expect(excluded).toEqual(new Set(["c"]));
  });
});
