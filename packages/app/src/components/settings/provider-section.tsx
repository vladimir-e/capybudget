import { useEffect, useState } from "react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { recheckClaudeCli } from "@/services/claude-cli-detect"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { PROVIDER_LABELS } from "@capybudget/intelligence"
import type { IntelligenceProvider } from "@capybudget/intelligence"
import { AnthropicConfig, OpenAiConfig } from "./api-provider-config"
import { ModelField, type ModelOption } from "./model-field"
import { TestResult, type TestState } from "./test-result"

declare const __IS_DEMO__: boolean

// CLI `--model` aliases plus the empty default. The custom field on
// ModelField covers any full model ID beyond these.
const CLAUDE_CLI_MODELS: ModelOption[] = [
  { value: "", label: "Default (Claude Code decides)" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
]

// The Claude Code adapter spawns the `claude` CLI and routes tool calls
// through an MCP server we run as a child Node process. In a distributed
// build that server isn't bundled yet (the path bakes in the build-time
// `process.cwd()` and `tsx` isn't on the user's machine), so even if
// `claude` itself is reachable on PATH, the session would die on first
// tool call. Until we ship a bundled MCP server resource, gate the
// provider on dev builds and point users to the source-build instructions.
const IS_DIST_BUILD = !import.meta.env.DEV
const BUILD_FROM_SOURCE_URL =
  "https://github.com/vladimir-e/capybudget#run-locally"

// The provider radio control needs a string per option; `null` (our
// "no provider" storage value) maps to/from this sentinel only inside
// the form. Outside this component, the provider is `null` again.
const OFF_FORM_VALUE = "off"
type ProviderFormValue = "off" | Exclude<IntelligenceProvider, null>

function toFormValue(provider: IntelligenceProvider): ProviderFormValue {
  return provider ?? OFF_FORM_VALUE
}

function fromFormValue(value: ProviderFormValue): IntelligenceProvider {
  return value === OFF_FORM_VALUE ? null : value
}

const PROVIDER_FORM_LABELS: Record<ProviderFormValue, string> = {
  off: "Off",
  ...PROVIDER_LABELS,
}

export function ProviderSection() {
  const provider = useIntelligenceStore((s) => s.config.provider)
  const setProvider = useIntelligenceStore((s) => s.setProvider)

  // Probe state — null means we haven't checked yet on this mount.
  const [claudeDetected, setClaudeDetected] = useState<boolean | null>(null)
  const [claudeProbing, setClaudeProbing] = useState(true)

  useEffect(() => {
    if (IS_DIST_BUILD) {
      // Skip the probe — Claude Code provider can't function without
      // the bundled MCP server (see IS_DIST_BUILD comment). Treat as
      // unavailable and let the hint copy point users at source build.
      setClaudeDetected(false)
      setClaudeProbing(false)
      return
    }
    let cancelled = false
    setClaudeProbing(true)
    recheckClaudeCli()
      .then((detected) => {
        if (!cancelled) setClaudeDetected(detected)
      })
      .catch(() => {
        if (!cancelled) setClaudeDetected(false)
      })
      .finally(() => {
        if (!cancelled) setClaudeProbing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleProviderChange(next: ProviderFormValue) {
    const nextProvider = fromFormValue(next)
    if (nextProvider === provider) return
    setProvider(nextProvider)
    toast.success(`Provider set to ${PROVIDER_FORM_LABELS[next]}`)
  }

  // Warn the user if they previously selected claude-cli but it's no
  // longer detected — don't auto-flip; let them decide. Never in the demo:
  // the demo seeds claude-cli to power its stubbed chat, but Settings there
  // is a disabled preview that reads as "Off", so the warning is noise.
  const claudeMissingWarning =
    !__IS_DEMO__ && provider === "claude-cli" && claudeDetected === false

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider</CardTitle>
        <CardDescription>
          Capy needs an AI provider to chat and process imports. Pick one and
          enter your credentials below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {__IS_DEMO__ && (
          <div className="flex items-start gap-3 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <div className="flex-1">
              <p className="font-medium">AI is only available in the desktop app</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The web demo runs entirely in your browser and can't store an AI
                provider. Download the desktop app to chat with Capy and use
                smart import.
              </p>
            </div>
          </div>
        )}

        {claudeMissingWarning && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              {IS_DIST_BUILD ? (
                <>
                  <p className="font-medium">
                    Claude Code requires a source build
                  </p>
                  <p className="text-xs text-destructive/80 mt-0.5">
                    The desktop app can't run Claude Code yet. Pick another
                    provider, or{" "}
                    <button
                      type="button"
                      className="underline hover:text-foreground transition-colors"
                      onClick={() => {
                        void shellOpen(BUILD_FROM_SOURCE_URL)
                      }}
                    >
                      run Capy from source
                    </button>{" "}
                    to use your Claude subscription.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">Claude Code is no longer detected</p>
                  <p className="text-xs text-destructive/80 mt-0.5">
                    Reinstall Claude Code or pick another provider to keep using
                    Capy.
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <RadioGroup
          // The demo's selection is a disabled preview — show "Off" rather than
          // the claude-cli seed that quietly powers its stubbed chat.
          value={__IS_DEMO__ ? OFF_FORM_VALUE : toFormValue(provider)}
          onValueChange={(v) => handleProviderChange(v as ProviderFormValue)}
          className="gap-3"
        >
          {/* "Off" is first so the default radio is visibly the
              opt-out — users explicitly enable AI features. The API
              providers lead; Claude Code is the advanced, source-build
              option and sits last. */}
          <ProviderRadio
            value={OFF_FORM_VALUE}
            label="Off"
            description="Capy is disabled. Pick a provider below to enable AI features."
            disabled={__IS_DEMO__}
          />
          <ProviderRadio
            value="anthropic"
            label="Anthropic API"
            description="Direct API calls. Pay-per-use with your own key."
            disabled={__IS_DEMO__}
          />
          <ProviderRadio
            value="openai"
            label="OpenAI API"
            description="Direct API calls. Pay-per-use with your own key."
            disabled={__IS_DEMO__}
          />
          <ProviderRadio
            value="claude-cli"
            label="Claude Code"
            badge="advanced"
            description="Use the local Claude Code CLI. Runs against your Claude subscription."
            disabled={__IS_DEMO__ || claudeDetected === false || claudeProbing}
            hint={
              __IS_DEMO__ ? undefined : IS_DIST_BUILD ? (
                <span>
                  Not available in the desktop build —{" "}
                  <button
                    type="button"
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => {
                      void shellOpen(BUILD_FROM_SOURCE_URL)
                    }}
                  >
                    build from source
                  </button>{" "}
                  to use your Claude subscription.
                </span>
              ) : claudeProbing ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking…
                </span>
              ) : claudeDetected === false ? (
                <span>
                  Not detected — install from{" "}
                  <button
                    type="button"
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => {
                      void shellOpen("https://claude.ai/code")
                    }}
                  >
                    claude.ai/code
                  </button>
                </span>
              ) : null
            }
          />
        </RadioGroup>

        {/* Per-provider configuration — null (Off) has no sub-config, and
            the demo can't run any provider. */}
        {!__IS_DEMO__ && provider !== null && (
          <div className="border-t pt-6">
            {provider === "claude-cli" && (
              <ClaudeCliConfig
                detected={claudeDetected}
                probing={claudeProbing}
                onRecheck={async () => {
                  setClaudeProbing(true)
                  try {
                    const detected = await recheckClaudeCli()
                    setClaudeDetected(detected)
                    return detected
                  } finally {
                    setClaudeProbing(false)
                  }
                }}
              />
            )}
            {provider === "anthropic" && <AnthropicConfig />}
            {provider === "openai" && <OpenAiConfig />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface ProviderRadioProps {
  value: ProviderFormValue
  label: string
  description: string
  disabled?: boolean
  badge?: string
  hint?: React.ReactNode
}

function ProviderRadio({
  value,
  label,
  description,
  disabled,
  badge,
  hint,
}: ProviderRadioProps) {
  return (
    <Label
      data-disabled={disabled || undefined}
      className={`group flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 px-4 py-3 transition-colors hover:bg-muted/30 has-[[data-checked]]:border-brand has-[[data-checked]]:bg-brand/5 ${
        disabled ? "opacity-60 cursor-not-allowed" : ""
      }`}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium leading-none">{label}</span>
          {badge && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          {description}
        </p>
        {hint && (
          <p className="text-xs text-muted-foreground/80 pt-0.5">{hint}</p>
        )}
      </div>
    </Label>
  )
}

interface ClaudeCliConfigProps {
  detected: boolean | null
  probing: boolean
  onRecheck: () => Promise<boolean>
}

function ClaudeCliConfig({ detected, probing, onRecheck }: ClaudeCliConfigProps) {
  const [testState, setTestState] = useState<TestState>({ kind: "idle" })
  const model = useIntelligenceStore((s) => s.config.claudeCli.model)
  const setModel = useIntelligenceStore((s) => s.setClaudeCliModel)

  async function handleTest() {
    setTestState({ kind: "running" })
    try {
      const ok = await onRecheck()
      if (ok) {
        setTestState({ kind: "success" })
        setTimeout(() => setTestState({ kind: "idle" }), 3000)
      } else {
        setTestState({
          kind: "error",
          message: "claude --version returned a non-zero exit code",
        })
      }
    } catch (err) {
      setTestState({
        kind: "error",
        message: err instanceof Error ? err.message : "Probe failed",
      })
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm">
            {probing ? (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
              </span>
            ) : detected ? (
              <span className="inline-flex items-center gap-1.5 text-amount-income">
                <Check className="h-3.5 w-3.5" /> Detected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" /> Not detected
              </span>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testState.kind === "running"}
          >
            {testState.kind === "running" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Testing…
              </>
            ) : (
              "Test connection"
            )}
          </Button>
        </div>
        <TestResult state={testState} />
      </div>

      <ModelField
        id="claude-cli-model"
        model={model}
        onSaveModel={setModel}
        models={CLAUDE_CLI_MODELS}
      />
    </div>
  )
}
