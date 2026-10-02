import { useEffect, useState } from "react"
import { FALLBACK_MODELS, type HostedProvider, type ModelOption } from "@capybudget/intelligence"
import { cachedProviderModels, forgetProviderModels, loadProviderModels } from "@/lib/provider-models"

type Outcome = { apiKey: string } & ({ models: ModelOption[] } | { failed: true })

export interface ProviderModels {
  models: ModelOption[]
  failed: boolean
  retry: () => void
}

export function useProviderModels(
  provider: HostedProvider,
  apiKey: string,
  keyPresent: boolean,
): ProviderModels {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!apiKey) {
      if (!keyPresent) forgetProviderModels(provider)
      return
    }
    let cancelled = false
    loadProviderModels(provider, apiKey).then(
      (models) => {
        if (!cancelled) setOutcome({ apiKey, models })
      },
      () => {
        if (!cancelled) setOutcome({ apiKey, failed: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [provider, apiKey, keyPresent, attempt])

  const current = apiKey && outcome?.apiKey === apiKey ? outcome : null
  const live =
    (current && "models" in current ? current.models : undefined) ??
    (apiKey ? cachedProviderModels(provider, apiKey) : undefined)

  return {
    models: live?.length ? live : FALLBACK_MODELS[provider],
    failed: current !== null && "failed" in current,
    retry: () => {
      setOutcome(null)
      setAttempt((n) => n + 1)
    },
  }
}
