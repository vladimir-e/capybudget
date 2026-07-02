import { describe, it, expect } from "vitest";
import { coerceIsoDate, isCalendarDate, SUPPORTED_DATE_FORMATS } from "./import-dates";

describe("coerceIsoDate", () => {
  it("passes an ISO date through unchanged", () => {
    expect(coerceIsoDate("2026-01-15")).toBe("2026-01-15");
  });

  it("parses common bank formats into ISO", () => {
    expect(coerceIsoDate("01/15/2026")).toBe("2026-01-15"); // MM/DD/YYYY
    expect(coerceIsoDate("1/5/2026")).toBe("2026-01-05"); // M/D/YYYY
    expect(coerceIsoDate("2026/01/15")).toBe("2026-01-15"); // YYYY/MM/DD
    expect(coerceIsoDate("01-15-2026")).toBe("2026-01-15"); // MM-DD-YYYY
    expect(coerceIsoDate("15.01.2026")).toBe("2026-01-15"); // DD.MM.YYYY
  });

  it("reads an ambiguous slash date as US MM/DD", () => {
    expect(coerceIsoDate("03/04/2026")).toBe("2026-03-04");
  });

  it("falls through to DD/MM when the first component can't be a month", () => {
    expect(coerceIsoDate("25/12/2026")).toBe("2026-12-25");
  });

  it("strips a time portion", () => {
    expect(coerceIsoDate("2026-01-15T14:30:00")).toBe("2026-01-15");
    expect(coerceIsoDate("01/15/2026 10:00")).toBe("2026-01-15");
  });

  it("tolerates surrounding whitespace", () => {
    expect(coerceIsoDate("  2026-01-15  ")).toBe("2026-01-15");
  });

  it("returns null for anything unparseable", () => {
    expect(coerceIsoDate("")).toBeNull();
    expect(coerceIsoDate("Pending")).toBeNull();
    expect(coerceIsoDate("March 1st")).toBeNull();
    expect(coerceIsoDate("2026-13-01")).toBeNull(); // shaped but not a calendar date
    expect(coerceIsoDate("02/30/2026")).toBeNull(); // no valid month/day reading
  });

  it("has no DD-MM-YYYY dash variant — a day-first dash date returns null", () => {
    expect(coerceIsoDate("25-12-2026")).toBeNull();
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true); // leap day
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
  });
});

describe("SUPPORTED_DATE_FORMATS", () => {
  it("lists ISO first so coercion prefers the unambiguous form", () => {
    expect(SUPPORTED_DATE_FORMATS[0]).toBe("YYYY-MM-DD");
    expect(SUPPORTED_DATE_FORMATS).toContain("MM/DD/YYYY");
    expect(SUPPORTED_DATE_FORMATS).toContain("DD/MM/YYYY");
  });
});
