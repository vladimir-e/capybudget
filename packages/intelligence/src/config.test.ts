import { describe, it, expect } from "vitest"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  OLLAMA_PLACEHOLDER_KEY,
  resolveApiTarget,
  type IntelligenceConfig,
} from "./config"

function config(overrides: Partial<IntelligenceConfig>): IntelligenceConfig {
  return { ...DEFAULT_INTELLIGENCE_CONFIG, ...overrides }
}

describe("resolveApiTarget", () => {
  it("resolves a hosted API provider to its trimmed key and model", () => {
    expect(
      resolveApiTarget(config({ provider: "openai", openai: { apiKey: " sk-oai\n", model: " gpt " } })),
    ).toEqual({ provider: "openai", apiKey: "sk-oai", model: "gpt" })
  })

  it("resolves Ollama to its endpoint and the placeholder key", () => {
    expect(
      resolveApiTarget(config({ provider: "ollama", ollama: { baseUrl: "http://x/v1", model: "qwen3" } })),
    ).toEqual({ provider: "ollama", apiKey: OLLAMA_PLACEHOLDER_KEY, model: "qwen3", baseUrl: "http://x/v1" })
  })

  it.each([
    ["an unloaded key", config({ provider: "anthropic", anthropic: { apiKey: "", model: "c", keyPresent: true } })],
    ["a whitespace key", config({ provider: "anthropic", anthropic: { apiKey: "  ", model: "c" } })],
    ["a blank API model", config({ provider: "openai", openai: { apiKey: "sk", model: " " } })],
    ["a blank Ollama model", config({ provider: "ollama", ollama: { baseUrl: "http://x/v1", model: " " } })],
    ["the CLI provider", config({ provider: "claude-cli" })],
    ["AI off", config({ provider: null })],
    ["an unknown provider", config({ provider: "gemini" as IntelligenceConfig["provider"] })],
  ])("is null for %s", (_label, c) => {
    expect(resolveApiTarget(c)).toBeNull()
  })
})
