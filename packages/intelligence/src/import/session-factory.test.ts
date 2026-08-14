import { describe, it, expect, vi } from "vitest";
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence";
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  OLLAMA_PLACEHOLDER_KEY,
  type IntelligenceConfig,
} from "../config";
import type { AdapterConstructors } from "../factory";
import type { CapySession } from "../session";
import {
  canImport,
  canReadPdf,
  createStructuredImportSession,
  importReady,
} from "./session-factory";

// A session that exposes the structured surface — the factory's #6 guard
// returns null for anything missing it.
const stubSession = { structured: vi.fn() } as unknown as CapySession;
const repo = {} as BudgetRepository;
const fileAdapter = {} as FileAdapter;

function adapters(): AdapterConstructors {
  return {
    anthropic: vi.fn(() => stubSession),
    openai: vi.fn(() => stubSession),
    ollama: vi.fn(() => stubSession),
    "claude-cli": vi.fn(() => stubSession),
  };
}

function config(overrides: Partial<IntelligenceConfig> = {}): IntelligenceConfig {
  return {
    ...DEFAULT_INTELLIGENCE_CONFIG,
    anthropic: { apiKey: "sk-ant", model: "claude" },
    openai: { apiKey: "sk-oai", model: "gpt" },
    ...overrides,
  };
}

const baseOptions = {
  budgetPath: "/b",
  systemPrompt: "P",
  repo,
  fileAdapter,
  currency: "USD",
};

describe("canImport", () => {
  it("allows every provider with a structured-call surface", () => {
    expect(canImport("anthropic")).toBe(true);
    expect(canImport("openai")).toBe(true);
    expect(canImport("ollama")).toBe(true);
    expect(canImport("claude-cli")).toBe(false);
    expect(canImport(null)).toBe(false);
  });
});

describe("importReady", () => {
  it("treats a chosen Ollama model as the key-equivalent gate", () => {
    expect(importReady(config({ provider: "ollama" }))).toBe(false);
    expect(
      importReady(
        config({ provider: "ollama", ollama: { baseUrl: "http://x/v1", model: "qwen3" } }),
      ),
    ).toBe(true);
  });
});

describe("canReadPdf", () => {
  it("allows Anthropic and OpenAI — not Ollama, the CLI, or off", () => {
    expect(canReadPdf("anthropic")).toBe(true);
    expect(canReadPdf("openai")).toBe(true);
    // Ollama can run imports but has no document content part.
    expect(canReadPdf("ollama")).toBe(false);
    expect(canReadPdf("claude-cli")).toBe(false);
    expect(canReadPdf(null)).toBe(false);
  });
});

describe("createStructuredImportSession", () => {
  it("builds an Anthropic structured session with the API model + prompt", () => {
    const adapterSet = adapters();
    const session = createStructuredImportSession({
      config: config({ provider: "anthropic" }),
      adapters: adapterSet,
      options: baseOptions,
    });

    expect(session).not.toBeNull();
    expect(adapterSet.anthropic).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude", apiKey: "sk-ant", systemPrompt: "P" }),
    );
  });

  it("builds an Ollama structured session with the local endpoint and no real key", () => {
    const adapterSet = adapters();
    const session = createStructuredImportSession({
      config: config({
        provider: "ollama",
        ollama: { baseUrl: "http://localhost:11434/v1", model: "qwen3" },
      }),
      adapters: adapterSet,
      options: baseOptions,
    });

    expect(session).not.toBeNull();
    expect(adapterSet.ollama).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen3",
        baseUrl: "http://localhost:11434/v1",
        apiKey: OLLAMA_PLACEHOLDER_KEY,
        systemPrompt: "P",
      }),
    );
  });

  it("returns null when Ollama has no model picked", () => {
    const adapterSet = adapters();
    const session = createStructuredImportSession({
      config: config({ provider: "ollama", ollama: { baseUrl: "http://x/v1", model: "" } }),
      adapters: adapterSet,
      options: baseOptions,
    });
    expect(session).toBeNull();
    expect(adapterSet.ollama).not.toHaveBeenCalled();
  });

  it("returns null for the deferred CLI provider", () => {
    const adapterSet = adapters();
    const session = createStructuredImportSession({
      config: config({ provider: "claude-cli" }),
      adapters: adapterSet,
      options: baseOptions,
    });
    expect(session).toBeNull();
    expect(adapterSet["claude-cli"]).not.toHaveBeenCalled();
  });

  it("returns null when AI is off", () => {
    expect(
      createStructuredImportSession({ config: config({ provider: null }), adapters: adapters(), options: baseOptions }),
    ).toBeNull();
  });

  it("returns null when the API key is missing", () => {
    const session = createStructuredImportSession({
      config: config({ provider: "openai", openai: { apiKey: "", model: "gpt" } }),
      adapters: adapters(),
      options: baseOptions,
    });
    expect(session).toBeNull();
  });

  it("returns null when the provider's adapter wasn't injected", () => {
    const session = createStructuredImportSession({
      config: config({ provider: "openai" }),
      adapters: { anthropic: vi.fn(() => stubSession) },
      options: baseOptions,
    });
    expect(session).toBeNull();
  });

  it("returns null when the adapter lacks a structured() surface", () => {
    const session = createStructuredImportSession({
      config: config({ provider: "anthropic" }),
      adapters: { anthropic: vi.fn(() => ({}) as unknown as CapySession) },
      options: baseOptions,
    });
    expect(session).toBeNull();
  });
});
