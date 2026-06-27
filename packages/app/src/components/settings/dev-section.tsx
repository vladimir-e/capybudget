/* eslint-disable i18next/no-literal-string -- dev-only diagnostics panel, intentionally not localized */
import { Fragment, useEffect, useState } from "react"
import { useSearch } from "@tanstack/react-router"
import { getTauriVersion, getVersion } from "@tauri-apps/api/app"
import { Bug, Copy } from "lucide-react"
import { useTheme } from "next-themes"
import { useFormatLocale } from "@capybudget/i18n"
import { PROVIDER_LABELS } from "@capybudget/intelligence"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useIntelligenceStore } from "@/stores/intelligence-store"

declare const __IS_DEMO__: boolean

const IN_TAURI = "__TAURI_INTERNALS__" in window

export function DevSection() {
  const { path, name } = useSearch({ from: "/budget" })
  const config = useIntelligenceStore((s) => s.config)
  const language = useFormatLocale()
  const { theme, resolvedTheme } = useTheme()

  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [tauriVersion, setTauriVersion] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [crash, setCrash] = useState(false)

  useEffect(() => {
    if (!IN_TAURI) return
    let cancelled = false
    void getVersion().then((v) => !cancelled && setAppVersion(v))
    void getTauriVersion().then((v) => !cancelled && setTauriVersion(v))
    return () => {
      cancelled = true
    }
  }, [])

  // Render-time throw — error boundaries only catch render errors, not event
  // handlers, so the click flips state and the throw happens on the next render.
  if (crash) {
    throw new Error("Developer panel: forced crash to test the error screen")
  }

  const provider = config.provider
  const model =
    provider === "anthropic"
      ? config.anthropic.model
      : provider === "openai"
        ? config.openai.model
        : provider === "claude-cli"
          ? config.claudeCli.model || "(CLI default)"
          : "—"

  const pending = IN_TAURI ? "…" : "n/a (web)"
  const rows: [string, string][] = [
    ["App version", appVersion ?? pending],
    ["Tauri version", tauriVersion ?? pending],
    ["Build mode", import.meta.env.MODE],
    ["import.meta.env.DEV", String(import.meta.env.DEV)],
    ["Demo build", String(__IS_DEMO__)],
    ["AI provider", provider ? PROVIDER_LABELS[provider] : "Off"],
    ["AI model", model],
    ["Budget", name],
    ["Budget path", path || "—"],
    ["Language", language],
    ["Theme", theme ?? "—"],
    ["Resolved theme", resolvedTheme ?? "—"],
    ["User agent", navigator.userAgent],
  ]

  const handleCopy = () => {
    const text = rows.map(([key, value]) => `${key}: ${value}`).join("\n")
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer</CardTitle>
        <CardDescription>
          Diagnostics and test tools. Dev builds only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="font-mono text-xs break-all">{value}</dd>
            </Fragment>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            <Copy className="h-4 w-4" />
            {copied ? "Copied" : "Copy diagnostics"}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setCrash(true)}>
            <Bug className="h-4 w-4" />
            Trigger error screen
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
