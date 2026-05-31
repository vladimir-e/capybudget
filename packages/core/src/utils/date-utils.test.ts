import { describe, it, expect, vi, afterEach } from "vitest";
import { toDateString, parseLocalDate, formatDateLabel, localDateTime, getToday } from "./date-utils";

describe("toDateString", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toDateString(new Date(2026, 2, 10))).toBe("2026-03-10");
  });

  it("pads single-digit month and day", () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("handles December 31", () => {
    expect(toDateString(new Date(2025, 11, 31))).toBe("2025-12-31");
  });
});

describe("getToday", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today's date as YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 11));
    expect(getToday()).toBe("2026-03-11");
  });
});

describe("parseLocalDate", () => {
  it("parses YYYY-MM-DD to a Date at noon", () => {
    const d = parseLocalDate("2026-03-10");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March = 2
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(12);
  });

  it("avoids timezone shift on edge dates", () => {
    // Noon prevents midnight UTC→previous day issues
    const d = parseLocalDate("2026-01-01");
    expect(d.getDate()).toBe(1);
  });
});

describe("formatDateLabel", () => {
  it("formats as 'Mon DD, YYYY'", () => {
    expect(formatDateLabel("2026-03-10")).toBe("Mar 10, 2026");
  });

  it("formats January correctly", () => {
    expect(formatDateLabel("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("formats December correctly", () => {
    expect(formatDateLabel("2025-12-25")).toBe("Dec 25, 2025");
  });
});

describe("localDateTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ISO-ish format without timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10, 14, 30, 5, 123));
    expect(localDateTime()).toBe("2026-03-10T14:30:05.123");
  });

  it("pads single-digit fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 3, 7, 9, 42));
    expect(localDateTime()).toBe("2026-01-05T03:07:09.042");
  });
});
