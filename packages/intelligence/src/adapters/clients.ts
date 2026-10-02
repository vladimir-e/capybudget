import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

// Tauri webview — the key lives on disk, not bundled into a public app.
const IN_WEBVIEW = { dangerouslyAllowBrowser: true }

// The OpenAI SDK requires a non-empty key; Ollama ignores it.
const OLLAMA_PLACEHOLDER_KEY = "ollama"

export function anthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, ...IN_WEBVIEW })
}

export function openAiClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, ...IN_WEBVIEW })
}

export function ollamaClient(baseUrl: string | undefined): OpenAI {
  return new OpenAI({ apiKey: OLLAMA_PLACEHOLDER_KEY, baseURL: baseUrl, ...IN_WEBVIEW })
}
