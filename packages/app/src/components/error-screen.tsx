import { useEffect, useState } from "react"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import { SKIP_LAUNCH_REDIRECT_KEY } from "@/routes/-launch-budget"
import capyMascot from "@/assets/capy-neutral.webp"

interface ErrorScreenProps {
  error: Error
  componentStack?: string | null
}

export function ErrorScreen({ error, componentStack }: ErrorScreenProps) {
  const { t } = useTranslation("common")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  const handleCopy = () => {
    const details = [error.stack ?? error.message, componentStack].filter(Boolean).join("\n")
    navigator.clipboard?.writeText(details).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  const handleRestart = () => {
    // Land on the budget selector, not the route that just crashed: suppress the
    // open-on-launch redirect once so a budget that crashes on open can't trap
    // the user in a reload loop. assign("/") reloads with fresh module state.
    sessionStorage.setItem(SKIP_LAUNCH_REDIRECT_KEY, "1")
    window.location.assign("/")
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

      <Button onClick={handleRestart}>{t("errors.crash.restart")}</Button>

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
