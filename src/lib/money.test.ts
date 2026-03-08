import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney } from "./money";

describe("formatMoney", () => {
  it("formats positive cents", () => {
    expect(formatMoney(1250)).toBe("$12.50");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("formats negative cents", () => {
    expect(formatMoney(-1250)).toBe("-$12.50");
  });

  it("pads single-digit cents", () => {
    expect(formatMoney(5)).toBe("$0.05");
  });

  it("formats large amounts with locale separators", () => {
    const result = formatMoney(123456789);
    expect(result).toMatch(/\$1,234,567\.89/);
  });
});

describe("parseMoney", () => {
  it("parses dollar string to cents", () => {
    expect(parseMoney("$12.50")).toBe(1250);
  });

  it("parses without dollar sign", () => {
    expect(parseMoney("12.50")).toBe(1250);
  });

  it("parses whole dollars", () => {
    expect(parseMoney("12")).toBe(1200);
  });

  it("parses single decimal place", () => {
    expect(parseMoney("12.5")).toBe(1250);
  });

  it("returns 0 for garbage input", () => {
    expect(parseMoney("abc")).toBe(0);
  });

  it("parses negative values", () => {
    expect(parseMoney("-$12.50")).toBe(-1250);
  });
});
