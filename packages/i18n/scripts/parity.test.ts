import { describe, it, expect } from "vitest";
import { checkParity } from "./parity";

// Runs the same parity assertion as `npm run i18n:check`, so catalog drift
// (a missing/extra key, or a locale registered without its directory) fails
// the normal `npm test` gate — not just a separately-remembered command.
describe("locale catalog parity", () => {
  it("every locale matches en's keys and the registry agrees with disk", () => {
    const { problems, localeCount, namespaceCount } = checkParity();
    expect(problems, problems.join("\n")).toEqual([]);
    expect(localeCount).toBeGreaterThanOrEqual(2);
    expect(namespaceCount).toBeGreaterThanOrEqual(1);
  });
});
