/*
 * One-shot connection tests for the API providers.
 *
 * Layering note: importing the SDKs here is a small compromise (the
 * adapter classes also import them) but the alternative is adding a
 * `testConnection()` method to every session class — surface area we
 * don't need elsewhere. Round 4 spec calls this out explicitly.
 */

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
