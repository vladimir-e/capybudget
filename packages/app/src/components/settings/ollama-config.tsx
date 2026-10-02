import { useEffect, useState } from "react"
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react"
import { DEFAULT_OLLAMA_BASE_URL } from "@capybudget/intelligence"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { listOllamaModels, pingOllama } from "@/lib/api-testing"
import { ExternalLinkButton } from "./external-link-button"
import { ModelField } from "./model-field"
import { TestResult, type TestState } from "./test-result"

const OLLAMA_SITE_URL = "https://ollama.com/download"
const OLLAMA_LIBRARY_URL = "https://ollama.com/library"

type ProbeState =
  | { kind: "probing" }
  | { kind: "ok"; models: string[] }
  | { kind: "unreachable" }

/** Ollama's settings: no key, and a model list discovered from the server. */
export function OllamaConfig() {
  const { t } = useTranslation("settings")
  const baseUrl = useIntelligenceStore((s) => s.config.ollama.baseUrl)
  const model = useIntelligenceStore((s) => s.config.ollama.model)
  const setBaseUrl = useIntelligenceStore((s) => s.setOllamaBaseUrl)
  const setModel = useIntelligenceStore((s) => s.setOllamaModel)

  const [draftUrl, setDraftUrl] = useState(baseUrl)
  const [probe, setProbe] = useState<ProbeState>({ kind: "probing" })
  const [testState, setTestState] = useState<TestState>({ kind: "idle" })
  const [probeToken, setProbeToken] = useState(0)

  // Probes the committed URL, not the draft; handlers flip "probing" so the
  // effect body never sets state synchronously.
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
      setTestState({
        kind: "error",
        message: "unreachable" in result ? t("provider.ollama.notRunningHint") : result.message,
      })
    }
  }

  const detected = probe.kind === "ok" ? probe.models : []
  const nothingPulled = probe.kind === "ok" && detected.length === 0
  const modelOptions = detected.map((id) => ({ value: id, label: id }))

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
      {nothingPulled && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
          <p className="text-muted-foreground">{t("provider.ollama.noModels")}</p>
          <ExternalLinkButton label={t("provider.ollama.browseModels")} href={OLLAMA_LIBRARY_URL} />
        </div>
      )}

      <ModelField
        id="ollama-model"
        model={model}
        onSaveModel={setModel}
        models={modelOptions}
        freeText={nothingPulled}
      />

      <p className="text-xs text-muted-foreground/80">{t("provider.ollama.toolsHint")}</p>

      <ExternalLinkButton label={t("provider.ollama.install")} href={OLLAMA_SITE_URL} />
    </div>
  )
}
