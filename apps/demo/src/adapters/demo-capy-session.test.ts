import {
  ENRICH_SYSTEM_PROMPT,
  IMPORT_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from "@capybudget/intelligence";
import { describe, expect, it } from "vitest";
import { detectMode } from "./demo-capy-session";

describe("detectMode", () => {
  it("routes the import prompt to import", () => {
    expect(detectMode(IMPORT_SYSTEM_PROMPT)).toBe("import");
  });

  it("routes the enrich prompt to enrich", () => {
    expect(detectMode(ENRICH_SYSTEM_PROMPT)).toBe("enrich");
  });

  it("routes the chat prompt to chat", () => {
    expect(detectMode(SYSTEM_PROMPT)).toBe("chat");
  });

  // Regression: APP_KNOWLEDGE's "normalize messy merchant names" leaks into the
  // chat prompt, so bare content-word matching wrongly ran the import sim.
  it("keeps a chat prompt containing the word 'normalize' in chat mode", () => {
    expect(SYSTEM_PROMPT).toContain("normalize");
    expect(detectMode(SYSTEM_PROMPT)).toBe("chat");
  });
});
