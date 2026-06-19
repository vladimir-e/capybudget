import { Check } from "lucide-react"
import { useTranslation } from "@capybudget/i18n"

export type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success" }
  | { kind: "error"; message: string }

export function TestResult({ state }: { state: TestState }) {
  const { t } = useTranslation("settings")
  if (state.kind === "idle" || state.kind === "running") return null
  if (state.kind === "success") {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-amount-income">
        <Check className="h-3 w-3" /> {t("provider.detection.connectionWorks")}
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
