import { Sparkles } from "lucide-react"
import { useTranslation } from "@capybudget/i18n"

interface CapyButtonProps {
  active: boolean
  onClick: () => void
}

export function CapyButton({ active, onClick }: CapyButtonProps) {
  const { t } = useTranslation("capy")
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? t("launcher.close") : t("launcher.open")}
      className={`
        relative flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium
        transition-all duration-300
        ${
          active
            ? "bg-brand text-primary-foreground shadow-sm hover:brightness-110"
            : "text-brand hover:bg-brand/10"
        }
      `}
    >
      {/* Glow only reads on the transparent idle pill — a solid fill hides it. */}
      {!active && <div className="capy-glow absolute inset-0 rounded-full" />}
      <Sparkles className="relative h-4 w-4" />
      <span className="relative hidden sm:inline">{t("launcher.label")}</span>
    </button>
  )
}
