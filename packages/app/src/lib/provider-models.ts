import type { HostedProvider, ModelOption } from "@capybudget/intelligence"
import { listModels } from "@capybudget/intelligence/adapters"

interface CacheEntry {
  apiKey: string
  request: Promise<ModelOption[]>
  models?: ModelOption[]
}

const cache = new Map<HostedProvider, CacheEntry>()

export function loadProviderModels(provider: HostedProvider, apiKey: string): Promise<ModelOption[]> {
  const hit = cache.get(provider)
  if (hit?.apiKey === apiKey) return hit.request
  const entry: CacheEntry = { apiKey, request: listModels({ provider, apiKey }) }
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

export function cachedProviderModels(provider: HostedProvider, apiKey: string): ModelOption[] | undefined {
  const hit = cache.get(provider)
  return hit?.apiKey === apiKey ? hit.models : undefined
}

export function forgetProviderModels(provider: HostedProvider) {
  cache.delete(provider)
}

export function _resetProviderModelsForTests() {
  cache.clear()
}
