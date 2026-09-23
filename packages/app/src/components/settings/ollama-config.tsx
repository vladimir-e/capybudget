import { useEffect, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { DEFAULT_OLLAMA_BASE_URL } from "@capybudget/intelligence"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { listOllamaModels, pingOllama } from "@/lib/api-testing"
import { ModelField, type ModelOption } from "./model-field"
import { TestResult, type TestState } from "./test-result"

const OLLAMA_SITE_URL = "https://ollama.com/download"

/** What the server said about its pulled models. `null` while a probe is in
 *  flight or before the first one. */
type ProbeState =
  | { kind: "probing" }
  | { kind: "ok"; models: string[] }
  | { kind: "unreachable" }

/**
 * Ollama's settings block. It differs from the API providers in both halves:
 * there is no key to store (the server authenticates nothing, so nothing goes
 * to the keychain), and the model list is discovered rather than curated —
 * only the user's machine knows what has been pulled.
 */
export function OllamaConfig() {
  const { t } = useTranslation("settings")
  const baseUrl = useIntelligenceStore((s) => s.config.ollama.baseUrl)
  const model = useIntelligenceStore((s) => s.config.ollama.model)
  const setBaseUrl = useIntelligenceStore((s) => s.setOllamaBaseUrl)
  const setModel = useIntelligenceStore((s) => s.setOllamaModel)

  const [draftUrl, setDraftUrl] = useState(baseUrl)
  const [probe, setProbe] = useState<ProbeState>({ kind: "probing" })
  const [testState, setTestState] = useState<TestState>({ kind: "idle" })
  // Bumped by the refresh button; the probe effect keys off it so a manual
  // re-check and an endpoint change run the exact same code path.
  const [probeToken, setProbeToken] = useState(0)

  // Probe the saved endpoint, never the in-progress draft — a half-typed URL
  // would fire a request per keystroke. Blur commits the draft, which changes
  // `baseUrl` and re-runs this. The "probing" flip happens in the handlers that
  // trigger a re-probe rather than here, so the effect only ever lands a
  // result: setting state synchronously in an effect body cascades renders.
  useEffect(() => {
    let cancelled = false
    listOllamaModels(baseUrl)
      .then((models) => {
        if (!cancelled) setProbe({ kind: "ok", models })
      })
      .catch(() => {
        if (!cancelled) setProbe({ kind: "unreachable" })
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, probeToken])

  function handleUrlBlur() {
    // Mirror the store's normalization locally so a cleared field visibly
    // snaps back to the stock endpoint instead of leaving the input empty
    // while the config says otherwise.
    const normalized = draftUrl.trim() || DEFAULT_OLLAMA_BASE_URL
    if (normalized !== draftUrl) setDraftUrl(normalized)
    if (normalized === baseUrl) return
    setProbe({ kind: "probing" })
    setBaseUrl(normalized)
  }

  async function handleTest() {
    if (!model) return
    setTestState({ kind: "running" })
    const result = await pingOllama(baseUrl, model)
    if (result.ok) {
      setTestState({ kind: "success" })
      setTimeout(() => setTestState({ kind: "idle" }), 3000)
    } else {
      setTestState({ kind: "error", message: result.message })
    }
  }

  // A model saved earlier but no longer pulled (or an unreachable server) must
  // still show up in the picker — dropping it would silently rewrite the user's
  // choice to blank.
  const detected = probe.kind === "ok" ? probe.models : []
  const modelOptions: ModelOption[] = (
    model && !detected.includes(model) ? [...detected, model] : detected
  ).map((id) => ({ value: id, label: id }))

  return (
    <div className="space-y-5">
      {/* Server URL */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="ollama-base-url">{t("provider.ollama.serverUrl")}</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!model || testState.kind === "running"}
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
        <Input
          id="ollama-base-url"
          type="text"
          inputMode="url"
          placeholder={DEFAULT_OLLAMA_BASE_URL}
          autoComplete="off"
          spellCheck={false}
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onBlur={handleUrlBlur}
        />
        <p className="text-xs text-muted-foreground/70">
          {t("provider.ollama.localOnly")}
        </p>
        <TestResult state={testState} />
      </div>

      {/* Reachability + model list */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm">
          {probe.kind === "probing" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
              {t("provider.detection.checking")}
            </span>
          ) : probe.kind === "ok" ? (
            <span className="inline-flex items-center gap-1.5 text-amount-income">
              <Check className="h-3.5 w-3.5" /> {t("provider.detection.detected")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {t("provider.detection.notDetected")}
            </span>
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setProbe({ kind: "probing" })
            setProbeToken((n) => n + 1)
          }}
          disabled={probe.kind === "probing"}
        >
          <RefreshCw className="h-3 w-3" /> {t("provider.ollama.refreshModels")}
        </Button>
      </div>

      {probe.kind === "unreachable" && (
        <p className="text-xs text-muted-foreground">
          {t("provider.ollama.notRunningHint")}
        </p>
      )}
      {probe.kind === "ok" && detected.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("provider.ollama.noModels")}</p>
      )}

      <ModelField
        id="ollama-model"
        model={model}
        onSaveModel={setModel}
        models={modelOptions}
      />

      <p className="text-xs text-muted-foreground/80">{t("provider.ollama.toolsHint")}</p>

      <button
        type="button"
        onClick={() => {
          void openUrl(OLLAMA_SITE_URL)
        }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("provider.ollama.install")}
        <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  )
}
