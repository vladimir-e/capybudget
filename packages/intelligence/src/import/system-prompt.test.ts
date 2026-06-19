import { describe, it, expect } from "vitest";
import {
  IMPORT_STRUCTURED_SYSTEM_PROMPT,
  buildImportSystemPrompt,
} from "./system-prompt";

describe("buildImportSystemPrompt", () => {
  it("is language-neutral — the import pipeline produces canonical, source-faithful data", () => {
    expect(buildImportSystemPrompt()).toBe(IMPORT_STRUCTURED_SYSTEM_PROMPT);
    expect(buildImportSystemPrompt()).not.toMatch(/in [A-Z][a-z]+\b/);
  });
});
