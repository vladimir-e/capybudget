import { describe, it, expect } from "vitest";
import {
  IMPORT_STRUCTURED_SYSTEM_PROMPT,
  buildImportSystemPrompt,
} from "./system-prompt";

describe("buildImportSystemPrompt", () => {
  it("returns the base prompt unchanged for English or no language", () => {
    expect(buildImportSystemPrompt()).toBe(IMPORT_STRUCTURED_SYSTEM_PROMPT);
    expect(buildImportSystemPrompt("English")).toBe(IMPORT_STRUCTURED_SYSTEM_PROMPT);
  });

  it("appends a language instruction for a non-English language", () => {
    const ru = buildImportSystemPrompt("Russian");
    expect(ru.startsWith(IMPORT_STRUCTURED_SYSTEM_PROMPT)).toBe(true);
    expect(ru).toContain("in Russian");
  });
});
