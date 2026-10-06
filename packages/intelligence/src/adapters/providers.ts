import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { DEFAULT_INTELLIGENCE_CONFIG, type HostedProvider } from "../config"
import { extractErrorMessage } from "../error-message"
import { anthropicModelOptions, ollamaModelOptions, openAiModelOptions, type ModelOption } from "../models"
import { anthropicClient, ollamaClient, openAiClient } from "./clients"

export type ProviderEndpoint =
  | { provider: HostedProvider; apiKey: string }
  | { provider: "ollama"; baseUrl: string }

export type PingTarget = ProviderEndpoint & { model: string }

export type PingResult = { ok: true } | { ok: false; message: string; unreachable: boolean }

/** One tiny request with the chosen model — unlike `listModels`, this fails
 *  when the key can't use the model or Ollama hasn't pulled it. */
export async function pingProvider(target: PingTarget): Promise<PingResult> {
  try {
    await ping(target)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      message: extractErrorMessage(err).message || "Connection failed",
      unreachable: err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError,
    }
  }
}

/** The models the endpoint offers, best first. Throws when it can't be reached. */
export async function listModels(endpoint: ProviderEndpoint): Promise<ModelOption[]> {
  switch (endpoint.provider) {
    case "anthropic":
      return anthropicModelOptions(await collect(anthropicClient(endpoint.apiKey).models.list()))
    case "openai":
      return openAiModelOptions(await collect(openAiClient(endpoint.apiKey).models.list()))
    case "ollama":
      return ollamaModelOptions(await collect(ollamaClient(endpoint.baseUrl).models.list()))
  }
}

async function ping(target: PingTarget): Promise<void> {
  switch (target.provider) {
    case "anthropic":
      await anthropicClient(target.apiKey).messages.create({
        model: target.model || DEFAULT_INTELLIGENCE_CONFIG.anthropic.model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Hi" }],
      })
      return
    case "openai":
      await openAiClient(target.apiKey).responses.create({
        model: target.model || DEFAULT_INTELLIGENCE_CONFIG.openai.model,
        max_output_tokens: 16,
        store: false,
        input: "Hi",
      })
      return
    case "ollama":
      await ollamaClient(target.baseUrl).chat.completions.create({
        model: target.model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Hi" }],
      })
  }
}

async function collect<T>(pages: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of pages) items.push(item)
  return items
}
