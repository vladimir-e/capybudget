/*
 * One-shot connection tests for the API providers.
 *
 * Layering note: importing the SDKs here is a small compromise (the
 * adapter classes also import them) but the alternative is adding a
 * `testConnection()` method to every session class — surface area we
 * don't need elsewhere. Round 4 spec calls this out explicitly.
 */

import {
  DEFAULT_INTELLIGENCE_CONFIG,
  OLLAMA_PLACEHOLDER_KEY,
  extractErrorMessage,
  ollamaOrigin,
} from "@capybudget/intelligence"

export interface PingResult {
  ok: boolean
  message: string
  unreachable?: boolean
}

function failed(err: unknown): PingResult {
  return { ok: false, message: extractErrorMessage(err).message || "Connection failed" }
}

export async function pingApi(
  provider: "anthropic" | "openai",
  apiKey: string,
  model: string,
): Promise<PingResult> {
  if (provider === "anthropic") return pingAnthropic(apiKey, model)
  return pingOpenAi(apiKey, model)
}

async function ollamaClient(baseUrl: string) {
  const { default: OpenAI } = await import("openai")
  return { OpenAI, client: new OpenAI({ apiKey: OLLAMA_PLACEHOLDER_KEY, baseURL: baseUrl, dangerouslyAllowBrowser: true }) }
}

/** Models the server has pulled. Throws on an unreachable server. */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const list = await (await ollamaClient(baseUrl)).client.models.list()
  return list.data.map((m) => m.id).sort((a, b) => a.localeCompare(b))
}

/** A one-shot chat — unlike the model list, this fails when the model isn't pulled. */
export async function pingOllama(baseUrl: string, model: string): Promise<PingResult> {
  const { OpenAI, client } = await ollamaClient(baseUrl)
  try {
    await client.chat.completions.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Hi" }],
    })
    return { ok: true, message: "" }
  } catch (err) {
    if (err instanceof OpenAI.APIConnectionError) {
      return { ok: false, message: `Can't reach Ollama at ${ollamaOrigin(baseUrl)}`, unreachable: true }
    }
    return failed(err)
  }
}

export async function pingAnthropic(
  apiKey: string,
  model: string,
): Promise<PingResult> {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk")
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    await client.messages.create({
      model: model || DEFAULT_INTELLIGENCE_CONFIG.anthropic.model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Hi" }],
    })
    return { ok: true, message: "" }
  } catch (err) {
    return failed(err)
  }
}

export async function pingOpenAi(
  apiKey: string,
  model: string,
): Promise<PingResult> {
  try {
    const { default: OpenAI } = await import("openai")
    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
    await client.responses.create({
      model: model || DEFAULT_INTELLIGENCE_CONFIG.openai.model,
      max_output_tokens: 16,
      store: false,
      input: "Hi",
    })
    return { ok: true, message: "" }
  } catch (err) {
    return failed(err)
  }
}
