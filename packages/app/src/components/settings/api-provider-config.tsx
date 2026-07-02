import { useState } from "react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { pingApi } from "@/lib/api-testing"
import { ModelField, type ModelOption } from "./model-field"
import { TestResult, type TestState } from "./test-result"

type ApiProviderKey = "anthropic" | "openai"

const ANTHROPIC_MODELS: ModelOption[] = [
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
]

const OPENAI_MODELS: ModelOption[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
]

// Per-provider presentation: everything that genuinely differs between the
// otherwise-identical API config blocks lives here, so the component body has
// zero provider branches. `providerName` is the brand (stays English) injected
// into the localized "Get an {{provider}} API key" link.
interface ProviderUi {
  keyPlaceholder: string
  providerName: string
  docHref: string
}

const PROVIDER_UI: Record<ApiProviderKey, ProviderUi> = {
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
  const model = useIntelligenceStore((s) => s.config.anthropic.model)
  const setKey = useIntelligenceStore((s) => s.setAnthropicKey)
  const setModel = useIntelligenceStore((s) => s.setAnthropicModel)

  return (
    <ApiProviderConfig
      providerKey="anthropic"
      apiKey={apiKey}
      onSaveKey={setKey}
      model={model}
      onSaveModel={setModel}
      models={ANTHROPIC_MODELS}
    />
  )
}

export function OpenAiConfig() {
  const apiKey = useIntelligenceStore((s) => s.config.openai.apiKey)
  const model = useIntelligenceStore((s) => s.config.openai.model)
  const setKey = useIntelligenceStore((s) => s.setOpenAiKey)
  const setModel = useIntelligenceStore((s) => s.setOpenAiModel)

  return (
    <ApiProviderConfig
      providerKey="openai"
      apiKey={apiKey}
      onSaveKey={setKey}
      model={model}
      onSaveModel={setModel}
      models={OPENAI_MODELS}
    />
  )
}

interface ApiProviderConfigProps {
  providerKey: ApiProviderKey
  apiKey: string
  onSaveKey: (k: string) => void
  model: string
  onSaveModel: (m: string) => void
  models: ModelOption[]
}

function ApiProviderConfig({
  providerKey,
  apiKey,
  onSaveKey,
  model,
  onSaveModel,
  models,
}: ApiProviderConfigProps) {
  const { t } = useTranslation("settings")
  const ui = PROVIDER_UI[providerKey]

  // Local draft for the API key — only commit on blur to avoid thrashing
  // persistence with every keystroke. If the persisted key changes
  // externally (e.g. cleared from another path), resync the draft via
  // React's "set state during render" pattern, which avoids the layout
  // thrash an effect-based resync would cause.
  const [draftKey, setDraftKey] = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<TestState>({ kind: "idle" })
  const [lastSyncedKey, setLastSyncedKey] = useState(apiKey)

  if (apiKey !== lastSyncedKey) {
    setLastSyncedKey(apiKey)
    setDraftKey(apiKey)
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
        <TestResult state={testState} />
      </div>

      <ModelField
        id={`${providerKey}-model`}
        model={model}
        onSaveModel={onSaveModel}
        models={models}
      />

      <ProviderDocLink
        label={t("provider.apiConfig.getApiKey", { provider: ui.providerName })}
        href={ui.docHref}
      />
    </div>
  )
}

function ProviderDocLink({ label, href }: { label: string; href: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void shellOpen(href)
      }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </button>
  )
}
