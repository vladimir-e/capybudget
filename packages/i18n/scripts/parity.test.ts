import { describe, it, expect } from "vitest";
import { checkParity } from "./parity";

// Mirrors `npm run i18n:check` so catalog drift fails the `npm test` gate too.
describe("locale catalog parity", () => {
  it("every locale matches en's keys and the registry agrees with disk", () => {
    const { problems, localeCount, namespaceCount } = checkParity();
    expect(problems, problems.join("\n")).toEqual([]);
    expect(localeCount).toBeGreaterThanOrEqual(2);
    expect(namespaceCount).toBeGreaterThanOrEqual(1);
  });
});
