import { useState } from "react"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import capyMascot from "@/assets/capy-neutral.webp"

interface ErrorScreenProps {
  error: Error
  componentStack?: string | null
}

export function ErrorScreen({ error, componentStack }: ErrorScreenProps) {
  const { t } = useTranslation("common")
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const details = [error.stack ?? error.message, componentStack].filter(Boolean).join("\n")
    navigator.clipboard?.writeText(details).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  return (
    <div
      role="alert"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background px-6 text-center"
    >
      <div
        className="relative flex h-28 w-28 items-center justify-center"
        aria-hidden="true"
      >
        <div className="capy-glow absolute inset-0 rounded-full" />
        <img
          src={capyMascot}
          alt=""
          className="relative h-24 w-24 rounded-full object-cover"
        />
      </div>

      <div className="max-w-sm space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground">{t("errors.crash.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("errors.crash.message")}</p>
      </div>

      {/* Go to root, not reload() — reloading restores the crashing route and errors again. */}
      <Button onClick={() => window.location.assign("/")}>{t("errors.crash.restart")}</Button>

      <div className="flex max-w-sm flex-col items-center gap-1.5">
        <p className="font-mono text-xs break-words text-muted-foreground/60">{error.message}</p>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={handleCopy}
        >
          {copied ? t("errors.crash.copied") : t("errors.crash.copyDetails")}
        </Button>
      </div>
    </div>
  )
}
