import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { importErrorCopy } from "./import-error-copy";
import type { ImportRunError } from "@/stores/import-store";

const t = ((key: string, params?: Record<string, string>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as TFunction<["import", "common"]>;

const error = (over: Partial<ImportRunError>): ImportRunError => ({
  reason: "internal",
  message: "raw vendor message",
  recoverable: false,
  ...over,
});

describe("importErrorCopy", () => {
  it("names the Ollama server it can't reach", () => {
    expect(importErrorCopy(error({ reason: "unreachable", provider: "ollama" }), t, "http://box:11434/v1")).toBe(
      'errors.ollamaUnreachable {"url":"http://box:11434"}',
    );
  });

  it("names a hosted provider it can't reach", () => {
    expect(importErrorCopy(error({ reason: "unreachable", provider: "openai" }), t, "")).toBe(
      'errors.unreachable {"provider":"OpenAI API"}',
    );
  });

  it("words a rejected key and a missing model", () => {
    expect(importErrorCopy(error({ status: 401, provider: "anthropic" }), t, "")).toBe(
      'errors.keyRejected {"provider":"Anthropic API"}',
    );
    expect(importErrorCopy(error({ status: 404, provider: "ollama" }), t, "")).toBe(
      'errors.modelNotFound {"provider":"Ollama"}',
    );
  });

  it("words a Categorizing run that landed nothing", () => {
    expect(importErrorCopy(error({ reason: "categorize" }), t, "")).toBe("errors.categorizeFailed");
  });

  it("falls back to the routed message", () => {
    expect(importErrorCopy(error({ status: 500, provider: "openai" }), t, "")).toBe("raw vendor message");
  });
});
