import { useEffect, useState } from "react"
import { useTranslation } from "@capybudget/i18n"
import capyMascot from "@/assets/capy-neutral.webp"

const INDICATOR_DELAY_MS = 200

export function BudgetLoading() {
  const { t } = useTranslation("budget")
  const [showIndicator, setShowIndicator] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowIndicator(true), INDICATOR_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      role="status"
      aria-label={t("shell.loading")}
      aria-busy="true"
      className="flex h-screen items-center justify-center bg-background"
    >
      {showIndicator && (
        <div
          className="relative flex h-28 w-28 items-center justify-center animate-in fade-in duration-500"
          aria-hidden="true"
        >
          <div className="capy-glow absolute inset-0 rounded-full" />
          <img
            src={capyMascot}
            alt=""
            className="relative h-24 w-24 rounded-full object-cover"
          />
        </div>
      )}
    </div>
  )
}
