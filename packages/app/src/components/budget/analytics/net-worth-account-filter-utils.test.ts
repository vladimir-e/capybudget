import { describe, it, expect } from "vitest";
import type { Account } from "@capybudget/core";
import {
  ARCHIVED_GROUP_KEY,
  computeIncludedIds,
  groupAccounts,
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
    currency: "USD",
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

  it("clear-all scoped to visible ids leaves out-of-scope accounts untouched", () => {
    // A search narrows the list to ["a"]; clear-all must only exclude "a" and
    // never silently drop the hidden "b"/"c".
    expect(setInclusionForIds(["a"], false, new Set())).toEqual(new Set(["a"]));
  });

  it("does not mutate the input set", () => {
    const excluded = new Set(["c"]);
    setInclusionForIds(["a", "b"], false, excluded);
    expect(excluded).toEqual(new Set(["c"]));
  });
});

describe("groupAccounts", () => {
  it("groups active accounts by type in ACCOUNT_TYPE_ORDER", () => {
    const groups = groupAccounts([
      makeAccount({ id: "card", type: "credit_card" }),
      makeAccount({ id: "cash", type: "cash" }),
      makeAccount({ id: "check", type: "checking" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["cash", "checking", "credit_card"]);
  });

  it("collects archived accounts into a single trailing Archived group", () => {
    const groups = groupAccounts([
      makeAccount({ id: "check", type: "checking" }),
      makeAccount({ id: "old", type: "savings", archived: true }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["checking", ARCHIVED_GROUP_KEY]);
    expect(groups[groups.length - 1].accounts.map((a) => a.id)).toEqual(["old"]);
  });

  it("never duplicates an archived account into its type group", () => {
    const groups = groupAccounts([
      makeAccount({ id: "active-savings", type: "savings" }),
      makeAccount({ id: "old-savings", type: "savings", archived: true }),
    ]);
    const savings = groups.find((g) => g.key === "savings");
    expect(savings?.accounts.map((a) => a.id)).toEqual(["active-savings"]);
    const archived = groups.find((g) => g.key === ARCHIVED_GROUP_KEY);
    expect(archived?.accounts.map((a) => a.id)).toEqual(["old-savings"]);
  });
});
