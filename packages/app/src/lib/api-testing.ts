/*
 * One-shot connection tests for the API providers.
 *
 * Layering note: importing the SDKs here is a small compromise (the
 * adapter classes also import them) but the alternative is adding a
 * `testConnection()` method to every session class — surface area we
 * don't need elsewhere. Round 4 spec calls this out explicitly.
 */

import { OLLAMA_PLACEHOLDER_KEY } from "@capybudget/intelligence"

export interface PingResult {
  ok: boolean
  message: string
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
  return new OpenAI({ apiKey: OLLAMA_PLACEHOLDER_KEY, baseURL: baseUrl, dangerouslyAllowBrowser: true })
}

/** Models the server has pulled. Throws on an unreachable server. */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  const list = await (await ollamaClient(baseUrl)).models.list()
  return list.data.map((m) => m.id).sort((a, b) => a.localeCompare(b))
}

/** A one-shot chat — unlike the model list, this fails when the model isn't pulled. */
export async function pingOllama(baseUrl: string, model: string): Promise<PingResult> {
  try {
    const client = await ollamaClient(baseUrl)
    await client.chat.completions.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "Hi" }],
    })
    return { ok: true, message: "" }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Connection failed",
    }
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
      model: model || "claude-sonnet-5",
      max_tokens: 8,
      messages: [{ role: "user", content: "Hi" }],
    })
    return { ok: true, message: "" }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Connection failed",
    }
  }
}

export async function pingOpenAi(
  apiKey: string,
  model: string,
): Promise<PingResult> {
  try {
    const { default: OpenAI } = await import("openai")
    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
    await client.chat.completions.create({
      model: model || "gpt-5.5",
      max_completion_tokens: 8,
      messages: [{ role: "user", content: "Hi" }],
    })
    return { ok: true, message: "" }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Connection failed",
    }
  }
}
