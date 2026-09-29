import type { ModelOption } from "@/lib/model-option"

export type ApiProvider = "anthropic" | "openai"

export const FALLBACK_MODELS: Record<ApiProvider, ModelOption[]> = {
  anthropic: [
    { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { value: "claude-opus-5", label: "Claude Opus 5" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-6-astra", label: "GPT-6 Astra" },
    { value: "gpt-6-sol", label: "GPT-6 Sol" },
    { value: "gpt-6-luna", label: "GPT-6 Luna" },
  ],
}

const OPENAI_CHAT_FAMILY = /^(gpt-\d|o\d)/
const OPENAI_NON_CHAT =
  /image|audio|realtime|tts|transcribe|embedding|moderation|search|instruct|deep-research|computer-use|^o1-(mini|preview)/
const SNAPSHOT_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{4})$/
const LOWERCASE_WORDS = new Set(["mini", "nano"])

export function isOpenAiChatModel(id: string): boolean {
  return OPENAI_CHAT_FAMILY.test(id) && !OPENAI_NON_CHAT.test(id)
}

export function openAiModelLabel(id: string): string {
  const snapshot = id.match(SNAPSHOT_SUFFIX)
  const base = snapshot ? id.slice(0, snapshot.index) : id
  const suffix = snapshot ? ` (${snapshot[1]})` : ""
  if (!base.startsWith("gpt-")) return base + suffix
  const [version, ...words] = base.slice("gpt-".length).split("-")
  const label = [
    `GPT-${version}`,
    ...words.map((w) => (LOWERCASE_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))),
  ].join(" ")
  return label + suffix
}

export function openAiModelOptions(models: { id: string; created: number }[]): ModelOption[] {
  const chat = models.filter((m) => isOpenAiChatModel(m.id))
  const ids = new Set(chat.map((m) => m.id))
  const isShadowedSnapshot = (id: string) => {
    const base = id.replace(SNAPSHOT_SUFFIX, "")
    return base !== id && ids.has(base)
  }
  return chat
    .filter((m) => !isShadowedSnapshot(m.id))
    .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
    .map((m) => ({ value: m.id, label: openAiModelLabel(m.id) }))
}

export function anthropicModelOptions(
  models: { id: string; display_name: string; created_at: string }[],
): ModelOption[] {
  return [...models]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((m) => ({ value: m.id, label: m.display_name }))
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk")
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const models = []
  for await (const m of client.models.list()) models.push(m)
  return anthropicModelOptions(models)
}

async function fetchOpenAiModels(apiKey: string): Promise<ModelOption[]> {
  const { default: OpenAI } = await import("openai")
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
  const models = []
  for await (const m of client.models.list()) models.push(m)
  return openAiModelOptions(models)
}

const FETCHERS: Record<ApiProvider, (apiKey: string) => Promise<ModelOption[]>> = {
  anthropic: fetchAnthropicModels,
  openai: fetchOpenAiModels,
}

interface CacheEntry {
  apiKey: string
  request: Promise<ModelOption[]>
  models?: ModelOption[]
}

const cache = new Map<ApiProvider, CacheEntry>()

export function loadProviderModels(provider: ApiProvider, apiKey: string): Promise<ModelOption[]> {
  const hit = cache.get(provider)
  if (hit?.apiKey === apiKey) return hit.request
  const entry: CacheEntry = { apiKey, request: FETCHERS[provider](apiKey) }
  entry.request.then(
    (models) => {
      entry.models = models
    },
    () => {
      if (cache.get(provider) === entry) cache.delete(provider)
    },
  )
  cache.set(provider, entry)
  return entry.request
}

export function cachedProviderModels(provider: ApiProvider, apiKey: string): ModelOption[] | undefined {
  const hit = cache.get(provider)
  return hit?.apiKey === apiKey ? hit.models : undefined
}

export function forgetProviderModels(provider: ApiProvider) {
  cache.delete(provider)
}

export function _resetProviderModelsForTests() {
  cache.clear()
}
