import { describe, it, expect } from "vitest";
import { matchAccountsByName } from "./import-matching";
import type { Account } from "./types";

function acct(id: string, name: string): Account {
  return { id, name, type: "checking", archived: false, sortOrder: 1, createdAt: "" };
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
});
