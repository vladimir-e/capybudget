import { describe, it, expect } from "vitest";
import { matchAccountsByName } from "./import-matching";
import type { Account } from "../entities/types";

function acct(id: string, name: string): Account {
  return { id, name, type: "checking", archived: false, excludeFromNetWorth: false, sortOrder: 1, createdAt: "" };
}

describe("matchAccountsByName", () => {
  const accounts = [
    acct("a1", "Chase Checking"),
    acct("a2", "💰 BofA Savings"),
    acct("a3", "Apple Card"),
  ];

  it("matches exact name", () => {
    const result = matchAccountsByName(["Chase Checking"], accounts);
    expect(result).toEqual({ "Chase Checking": "a1" });
  });

  it("matches case-insensitively", () => {
    const result = matchAccountsByName(["chase checking", "APPLE CARD"], accounts);
    expect(result).toEqual({ "chase checking": "a1", "APPLE CARD": "a3" });
  });

  it("trims whitespace", () => {
    const result = matchAccountsByName(["  Chase Checking  "], accounts);
    expect(result).toEqual({ "  Chase Checking  ": "a1" });
  });

  it("skips unmatched source accounts", () => {
    const result = matchAccountsByName(["Unknown Bank"], accounts);
    expect(result).toEqual({});
  });

  it("skips empty strings", () => {
    const result = matchAccountsByName(["", "Chase Checking"], accounts);
    expect(result).toEqual({ "Chase Checking": "a1" });
  });

  it("deduplicates — same source resolves to same ID", () => {
    const result = matchAccountsByName(
      ["Chase Checking", "Chase Checking", "Chase Checking"],
      accounts,
    );
    expect(result).toEqual({ "Chase Checking": "a1" });
  });

  it("handles emoji account names", () => {
    const result = matchAccountsByName(["💰 BofA Savings"], accounts);
    expect(result).toEqual({ "💰 BofA Savings": "a2" });
  });

  it("matches plain source against emoji account name", () => {
    const result = matchAccountsByName(["BofA Savings"], accounts);
    expect(result).toEqual({ "BofA Savings": "a2" });
  });

  it("matches emoji source against plain account name", () => {
    const plainAccounts = [acct("a1", "Chase Checking")];
    const result = matchAccountsByName(["🏦 Chase Checking"], plainAccounts);
    expect(result).toEqual({ "🏦 Chase Checking": "a1" });
  });

  it("matches substring: source is contained in account name", () => {
    // "BofA" is a substring of "BofA Savings" (after emoji strip)
    const result = matchAccountsByName(["BofA"], accounts);
    expect(result).toEqual({ "BofA": "a2" });
  });

  it("matches substring: account name is contained in source", () => {
    const shortAccounts = [acct("a1", "Chase")];
    const result = matchAccountsByName(["Chase Checking Premium"], shortAccounts);
    expect(result).toEqual({ "Chase Checking Premium": "a1" });
  });

  it("prefers exact match over substring match", () => {
    const accts = [
      acct("a1", "Chase"),
      acct("a2", "Chase Checking"),
    ];
    const result = matchAccountsByName(["Chase Checking"], accts);
    expect(result).toEqual({ "Chase Checking": "a2" });
  });

  it("does not false-positive on unrelated accounts", () => {
    const result = matchAccountsByName(["Wells Fargo"], accounts);
    expect(result).toEqual({});
  });

  it("handles multiple emoji in account name", () => {
    const emojiAccounts = [acct("a1", "🏦💳 Premium Card")];
    const result = matchAccountsByName(["Premium Card"], emojiAccounts);
    expect(result).toEqual({ "Premium Card": "a1" });
  });
});
