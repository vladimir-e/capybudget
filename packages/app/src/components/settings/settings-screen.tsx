import { useEffect, useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Settings,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { recheckClaudeCli } from "@/services/claude-cli-detect"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import type { IntelligenceProvider } from "@capybudget/intelligence"

const ANTHROPIC_MODELS = [
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
]

const OPENAI_MODELS = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
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

export function SettingsScreen() {
  const router = useRouter()

  function handleBack() {
    if (router.history.length > 1) {
      router.history.back()
    } else {
      router.navigate({ to: "/" })
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-gradient-to-b from-brand-subtle/40 to-transparent px-6 py-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="Back"
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <Settings className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground">
              Configure your AI provider and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <ProviderSection />
        </div>
      </div>
    </div>
  )
}

/* ── AI Provider Section ────────────────────────────────────── */

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

const PROVIDER_LABELS: Record<ProviderFormValue, string> = {
  off: "Off",
  "claude-cli": "Claude Code",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
}

function ProviderSection() {
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
    toast.success(`Provider set to ${PROVIDER_LABELS[next]}`)
  }

  // Warn the user if they previously selected claude-cli but it's no
  // longer detected — don't auto-flip; let them decide.
  const claudeMissingWarning =
    provider === "claude-cli" && claudeDetected === false

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
          value={toFormValue(provider)}
          onValueChange={(v) => handleProviderChange(v as ProviderFormValue)}
          className="gap-3"
        >
          {/* "Off" is first so the default radio is visibly the
              opt-out — users explicitly enable AI features. */}
          <ProviderRadio
            value={OFF_FORM_VALUE}
            label="Off"
            description="Capy is disabled. Pick a provider below to enable AI features."
          />
          <ProviderRadio
            value="claude-cli"
            label="Claude Code"
            description="Use the local Claude Code CLI. Runs against your Claude subscription."
            disabled={claudeDetected === false || claudeProbing}
            hint={
              IS_DIST_BUILD ? (
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
          <ProviderRadio
            value="anthropic"
            label="Anthropic API"
            description="Direct API calls. Pay-per-use with your own key."
          />
          <ProviderRadio
            value="openai"
            label="OpenAI API"
            description="Direct API calls. Pay-per-use with your own key."
          />
        </RadioGroup>

        {/* Per-provider configuration — null (Off) has no sub-config. */}
        {provider !== null && (
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
  hint?: React.ReactNode
}

function ProviderRadio({
  value,
  label,
  description,
  disabled,
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
        <div className="text-sm font-medium leading-none">{label}</div>
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

/* ── Claude CLI sub-section ─────────────────────────────────── */

interface ClaudeCliConfigProps {
  detected: boolean | null
  probing: boolean
  onRecheck: () => Promise<boolean>
}

function ClaudeCliConfig({
  detected,
  probing,
  onRecheck,
}: ClaudeCliConfigProps) {
  const [testState, setTestState] = useState<TestState>({ kind: "idle" })

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
  )
}

/* ── Anthropic sub-section ──────────────────────────────────── */

function AnthropicConfig() {
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

/* ── OpenAI sub-section ─────────────────────────────────────── */

function OpenAiConfig() {
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

/* ── Shared API provider config ─────────────────────────────── */

interface ApiProviderConfigProps {
  providerKey: "anthropic" | "openai"
  apiKey: string
  onSaveKey: (k: string) => void
  model: string
  onSaveModel: (m: string) => void
  models: { value: string; label: string }[]
}

function ApiProviderConfig({
  providerKey,
  apiKey,
  onSaveKey,
  model,
  onSaveModel,
  models,
}: ApiProviderConfigProps) {
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

  // Custom-model toggle: on if the current model is not in the curated list.
  const isModelInList = models.some((m) => m.value === model)
  const [customMode, setCustomMode] = useState(!isModelInList && model !== "")

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
          <Label htmlFor={`${providerKey}-api-key`}>API key</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={!draftKey || testState.kind === "running"}
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
        <div className="relative">
          <Input
            id={`${providerKey}-api-key`}
            type={showKey ? "text" : "password"}
            placeholder={
              providerKey === "anthropic" ? "sk-ant-…" : "sk-proj-…"
            }
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
            aria-label={showKey ? "Hide API key" : "Show API key"}
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
            Stored locally in your app config folder.
          </p>
          {lastFour && (
            <p className="text-muted-foreground/70 tabular-nums">
              Saved key ends in <span className="font-mono">…{lastFour}</span>
            </p>
          )}
        </div>
        <TestResult state={testState} />
      </div>

      {/* Model field */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${providerKey}-model`}>Model</Label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox"
              className="h-3 w-3 cursor-pointer accent-brand"
              checked={customMode}
              onChange={(e) => setCustomMode(e.target.checked)}
            />
            Use a custom model
          </label>
        </div>
        {customMode ? (
          <Input
            id={`${providerKey}-model`}
            placeholder="model-identifier"
            value={model}
            onChange={(e) => onSaveModel(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        ) : (
          <Select
            value={model}
            onValueChange={(v) => {
              if (typeof v === "string") onSaveModel(v)
            }}
          >
            <SelectTrigger id={`${providerKey}-model`} className="w-full">
              <SelectValue placeholder="Select a model…" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {providerKey === "anthropic" && (
        <ProviderDocLink
          label="Get an Anthropic API key"
          href="https://console.anthropic.com/settings/keys"
        />
      )}
      {providerKey === "openai" && (
        <ProviderDocLink
          label="Get an OpenAI API key"
          href="https://platform.openai.com/api-keys"
        />
      )}
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

/* ── Test result indicator ──────────────────────────────────── */

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success" }
  | { kind: "error"; message: string }

function TestResult({ state }: { state: TestState }) {
  if (state.kind === "idle" || state.kind === "running") return null
  if (state.kind === "success") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-amount-income">
        <Check className="h-3 w-3" /> Connection works
      </p>
    )
  }
  // Truncate long error messages to keep the layout calm.
  const truncated =
    state.message.length > 120
      ? state.message.slice(0, 117) + "…"
      : state.message
  return (
    <p
      className="text-xs text-destructive break-words"
      role="alert"
      aria-live="polite"
    >
      {truncated}
    </p>
  )
}

/* ── One-shot ping helpers ──────────────────────────────────── */
/*
 * Layering note: importing the SDKs here is a small compromise (the
 * adapter classes also import them) but the alternative is adding a
 * `testConnection()` method to every session class — surface area we
 * don't need elsewhere. Round 4 spec calls this out explicitly.
 */

interface PingResult {
  ok: boolean
  message: string
}

async function pingApi(
  provider: "anthropic" | "openai",
  apiKey: string,
  model: string,
): Promise<PingResult> {
  if (provider === "anthropic") return pingAnthropic(apiKey, model)
  return pingOpenAi(apiKey, model)
}

async function pingAnthropic(apiKey: string, model: string): Promise<PingResult> {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk")
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
    await client.messages.create({
      model: model || "claude-sonnet-4-6",
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

async function pingOpenAi(apiKey: string, model: string): Promise<PingResult> {
  try {
    const { default: OpenAI } = await import("openai")
    const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
    await client.chat.completions.create({
      model: model || "gpt-5.4",
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
