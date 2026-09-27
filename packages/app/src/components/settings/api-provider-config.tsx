import { useEffect, useState } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { hasProviderKey } from "@capybudget/intelligence"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { pingApi } from "@/lib/api-testing"
import { useProviderModels } from "@/hooks/use-provider-models"
import type { ApiProvider } from "@/lib/provider-models"
import { ExternalLinkButton } from "./external-link-button"
import { ModelField } from "./model-field"
import { TestResult, type TestState } from "./test-result"

// Per-provider presentation: everything that genuinely differs between the
// otherwise-identical API config blocks lives here, so the component body has
// zero provider branches. `providerName` is the brand (stays English) injected
// into the localized "Get an {{provider}} API key" link.
interface ProviderUi {
  keyPlaceholder: string
  providerName: string
  docHref: string
}

const PROVIDER_UI: Record<ApiProvider, ProviderUi> = {
  anthropic: {
    keyPlaceholder: "sk-ant-…",
    providerName: "Anthropic",
    docHref: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    keyPlaceholder: "sk-proj-…",
    providerName: "OpenAI",
    docHref: "https://platform.openai.com/api-keys",
  },
}

export function AnthropicConfig() {
  const apiKey = useIntelligenceStore((s) => s.config.anthropic.apiKey)
  const keyPresent = useIntelligenceStore((s) => hasProviderKey(s.config.anthropic))
  const model = useIntelligenceStore((s) => s.config.anthropic.model)
  const setKey = useIntelligenceStore((s) => s.setAnthropicKey)
  const setModel = useIntelligenceStore((s) => s.setAnthropicModel)

  return (
    <ApiProviderConfig
      providerKey="anthropic"
      apiKey={apiKey}
      keyPresent={keyPresent}
      onSaveKey={setKey}
      model={model}
      onSaveModel={setModel}
    />
  )
}

export function OpenAiConfig() {
  const apiKey = useIntelligenceStore((s) => s.config.openai.apiKey)
  const keyPresent = useIntelligenceStore((s) => hasProviderKey(s.config.openai))
  const model = useIntelligenceStore((s) => s.config.openai.model)
  const setKey = useIntelligenceStore((s) => s.setOpenAiKey)
  const setModel = useIntelligenceStore((s) => s.setOpenAiModel)

  return (
    <ApiProviderConfig
      providerKey="openai"
      apiKey={apiKey}
      keyPresent={keyPresent}
      onSaveKey={setKey}
      model={model}
      onSaveModel={setModel}
    />
  )
}

interface ApiProviderConfigProps {
  providerKey: ApiProvider
  apiKey: string
  keyPresent: boolean
  onSaveKey: (k: string) => void
  model: string
  onSaveModel: (m: string) => void
}

function ApiProviderConfig({
  providerKey,
  apiKey,
  keyPresent,
  onSaveKey,
  model,
  onSaveModel,
}: ApiProviderConfigProps) {
  const { t } = useTranslation("settings")
  const ui = PROVIDER_UI[providerKey]
  const ensureSecrets = useIntelligenceStore((s) => s.ensureSecrets)
  const secretsError = useIntelligenceStore((s) => s.secretsError)
  const models = useProviderModels(providerKey, apiKey)

  // A saved key exists but its value hasn't been fetched from the keychain yet —
  // load it (behind the one-time heads-up) so the last-4 can render. A fresh
  // provider switch with no key configured skips this: nothing to unlock.
  useEffect(() => {
    if (keyPresent && !apiKey) void ensureSecrets()
  }, [keyPresent, apiKey, ensureSecrets])

  // Local draft for the API key — only commit on blur to avoid thrashing
  // persistence with every keystroke. If the persisted key changes externally
  // (an on-demand keychain load resolving, or a clear from another path),
  // resync the draft via React's "set state during render" pattern, which
  // avoids the layout thrash an effect-based resync would cause. But only when
  // the draft still matches the last synced baseline — a diverged draft means
  // the user is mid-edit, and a load landing before blur must not clobber their
  // input. Either way advance the baseline so a later external change resyncs.
  const [draftKey, setDraftKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<TestState>({ kind: "idle" })
  const [lastSyncedKey, setLastSyncedKey] = useState(apiKey)

  if (apiKey !== lastSyncedKey) {
    if (draftKey === lastSyncedKey) setDraftKey(apiKey)
    setLastSyncedKey(apiKey)
  }

  function handleKeyBlur() {
    if (draftKey === apiKey) return
    onSaveKey(draftKey)
    setLastSyncedKey(draftKey)
  }

  async function handleTest() {
    if (!draftKey) return
    // Persist any pending edits before testing — the test should reflect
    // what the adapter will see.
    if (draftKey !== apiKey) {
      onSaveKey(draftKey)
      setLastSyncedKey(draftKey)
    }
    setTestState({ kind: "running" })
    const result = await pingApi(providerKey, draftKey, model)
    if (result.ok) {
      setTestState({ kind: "success" })
      setTimeout(() => setTestState({ kind: "idle" }), 3000)
    } else {
      setTestState({ kind: "error", message: result.message })
    }
  }

  const lastFour = apiKey.length >= 4 ? apiKey.slice(-4) : null

  return (
    <div className="space-y-5">
      {/* API key field */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${providerKey}-api-key`}>{t("provider.apiConfig.apiKey")}</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!draftKey || testState.kind === "running"}
          >
            {testState.kind === "running" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> {t("provider.detection.testing")}
              </>
            ) : (
              t("provider.detection.testConnection")
            )}
          </Button>
        </div>
        <div className="relative">
          <Input
            id={`${providerKey}-api-key`}
            type={showKey ? "text" : "password"}
            placeholder={ui.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="pr-10"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            onBlur={handleKeyBlur}
          />
          <button
            type="button"
            onClick={() => setShowKey((p) => !p)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label={showKey ? t("provider.apiConfig.hideKey") : t("provider.apiConfig.showKey")}
          >
            {showKey ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between text-xs">
          <p className="text-muted-foreground/70">
            {t("provider.apiConfig.storedLocally")}
          </p>
          {lastFour && (
            <p className="text-muted-foreground/70 tabular-nums">
              {t("provider.apiConfig.savedKeyEndsIn")}{" "}
              <span className="font-mono">…{lastFour}</span>
            </p>
          )}
        </div>
        {secretsError && keyPresent && !apiKey && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <p className="text-destructive">{t("provider.apiConfig.keychainError")}</p>
            <Button variant="outline" size="sm" onClick={() => void ensureSecrets()}>
              {t("provider.apiConfig.retry")}
            </Button>
          </div>
        )}
        <TestResult state={testState} />
      </div>

      <div className="space-y-2">
        <ModelField
          id={`${providerKey}-model`}
          model={model}
          onSaveModel={onSaveModel}
          models={models.models}
        />
        {models.failed && (
          <p className="text-xs text-muted-foreground/70">
            {t("provider.model.listUnavailable")}{" "}
            <button
              type="button"
              onClick={models.retry}
              className="rounded-sm underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {t("provider.apiConfig.retry")}
            </button>
          </p>
        )}
      </div>

      <ExternalLinkButton
        label={t("provider.apiConfig.getApiKey", { provider: ui.providerName })}
        href={ui.docHref}
      />
    </div>
  )
}
