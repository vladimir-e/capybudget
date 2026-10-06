import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"
import {
  DEFAULT_INTELLIGENCE_CONFIG,
  type IntelligenceConfig,
} from "@capybudget/intelligence"

export type LiveProvider = "anthropic" | "openai" | "claude-cli"

export interface LiveTarget {
  provider: LiveProvider
  model: string
  label: string
}

const DEFAULT_MODELS = [
  "anthropic:claude-opus-5-5",
  "anthropic:claude-haiku-4-5",
  "openai:gpt-6-astra",
  "openai:gpt-6-luna",
  "openai:gpt-4.1",
  "claude-cli:haiku",
]

const PROVIDERS: readonly LiveProvider[] = ["anthropic", "openai", "claude-cli"]

export function liveTargets(spec = process.env.LIVE_MODELS): LiveTarget[] {
  const entries = spec?.trim() ? spec.split(",") : DEFAULT_MODELS
  return entries.map((entry) => {
    const trimmed = entry.trim()
    const sep = trimmed.indexOf(":")
    const provider = trimmed.slice(0, sep) as LiveProvider
    const model = trimmed.slice(sep + 1)
    if (sep <= 0 || !model || !PROVIDERS.includes(provider)) {
      throw new Error(
        `LIVE_MODELS entry "${trimmed}" must be <provider>:<model>, provider one of ${PROVIDERS.join(", ")}`,
      )
    }
    return { provider, model, label: `${provider}:${model}` }
  })
}

export function unavailableReason(target: LiveTarget): string | null {
  switch (target.provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ? null : "no ANTHROPIC_API_KEY"
    case "openai":
      return process.env.OPENAI_API_KEY ? null : "no OPENAI_API_KEY"
    case "claude-cli":
      return onPath("claude") ? null : "`claude` not on PATH"
  }
}

export function intelligenceConfig(target: LiveTarget): IntelligenceConfig {
  const config: IntelligenceConfig = { ...DEFAULT_INTELLIGENCE_CONFIG, provider: target.provider }
  switch (target.provider) {
    case "anthropic":
      config.anthropic = { apiKey: process.env.ANTHROPIC_API_KEY ?? "", model: target.model, keyPresent: true }
      break
    case "openai":
      config.openai = { apiKey: process.env.OPENAI_API_KEY ?? "", model: target.model, keyPresent: true }
      break
    case "claude-cli":
      config.claudeCli = { model: target.model }
      break
  }
  return config
}

function onPath(bin: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, bin), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}
