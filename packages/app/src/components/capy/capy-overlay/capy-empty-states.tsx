import { type RefObject } from "react"
import {
  GraduationCap,
  Repeat,
  Settings,
  Sparkles,
  Tags,
} from "lucide-react"
import { useTranslation } from "@capybudget/i18n"
import capyMascot from "@/assets/capy-neutral.webp"
import type { IntelligenceProvider } from "@capybudget/intelligence"

/* ── Mascot hero ───────────────────────────────────────────────── */

function MascotHero() {
  return (
    <div
      className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, color-mix(in oklab, var(--brand) 55%, transparent) 0%, color-mix(in oklab, var(--brand) 18%, transparent) 45%, transparent 75%)",
          filter: "blur(14px)",
        }}
      />
      <img
        src={capyMascot}
        alt=""
        className="relative h-24 w-24 rounded-full object-cover"
      />
    </div>
  )
}

/* ── Empty states ─────────────────────────────────────────────── */

interface UnconfiguredEmptyStateProps {
  claudeCliAvailable: boolean | null
  onPickProvider: (provider: IntelligenceProvider) => void
  onOpenSettings: () => void
  firstChipRef: RefObject<HTMLButtonElement | null>
}

// Brand names, not UI copy — verbatim across locales.
const PROVIDER_CHIPS: ReadonlyArray<{ provider: IntelligenceProvider; label: string }> = [
  { provider: "claude-cli", label: "Claude Code" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "openai", label: "OpenAI" },
]

export function UnconfiguredEmptyState({
  claudeCliAvailable,
  onPickProvider,
  onOpenSettings,
  firstChipRef,
}: UnconfiguredEmptyStateProps) {
  const { t } = useTranslation("capy")
  return (
    <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
      <MascotHero />
      <h3 className="text-lg font-semibold text-foreground">
        {t("unconfigured.title")}
      </h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        {t("unconfigured.description")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {PROVIDER_CHIPS.map(({ provider, label }, idx) => {
          const isClaudeCli = provider === "claude-cli"
          // Disable the Claude Code chip while detection is pending (null)
          // and when the CLI is absent (false). Only `true` enables the
          // chip — otherwise a fast clicker can race-set provider on a
          // machine where the CLI isn't actually installed.
          const disabled = isClaudeCli && claudeCliAvailable !== true
          const title = disabled
            ? claudeCliAvailable === null
              ? t("unconfigured.claudeCliChecking")
              : t("unconfigured.claudeCliMissing")
            : undefined
          return (
            <button
              key={provider}
              type="button"
              ref={idx === 0 ? firstChipRef : undefined}
              onClick={() => onPickProvider(provider)}
              disabled={disabled}
              title={title}
              className="rounded-full border border-border/40 bg-muted/40 px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/40 disabled:hover:bg-muted/40 disabled:hover:text-foreground/80"
            >
              {label}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90"
      >
        <Settings className="h-4 w-4" />
        {t("unconfigured.openSettings")}
      </button>
    </div>
  )
}

interface SuggestionCard {
  id: "help" | "learn" | "subscriptions" | "categorize"
  icon: typeof Sparkles
}

const SUGGESTION_CARDS: ReadonlyArray<SuggestionCard> = [
  { id: "help", icon: Sparkles },
  { id: "learn", icon: GraduationCap },
  { id: "subscriptions", icon: Repeat },
  { id: "categorize", icon: Tags },
]

interface ConfiguredEmptyStateProps {
  onSuggestion: (prompt: string) => void
}

export function ConfiguredEmptyState({ onSuggestion }: ConfiguredEmptyStateProps) {
  const { t } = useTranslation("capy")
  return (
    <div className="flex flex-col items-center px-2 py-8 text-center">
      <MascotHero />
      <h3 className="text-lg font-semibold text-foreground">
        {t("welcome.greeting")}
      </h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        {t("welcome.description")}
      </p>
      <div className="mt-6 grid w-full grid-cols-2 gap-2">
        {SUGGESTION_CARDS.map((card) => {
          const Icon = card.icon
          const prompt = t(`welcome.suggestions.${card.id}.prompt`)
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSuggestion(prompt)}
              className="group flex items-start gap-2.5 rounded-xl border border-border/40 bg-muted/30 p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand transition-colors group-hover:text-brand" />
              <span className="text-xs font-medium text-foreground/85 leading-snug">
                {t(`welcome.suggestions.${card.id}.label`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
