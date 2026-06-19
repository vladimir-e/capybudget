import {
  SUPPORTED_LOCALES,
  isSupportedLocale,
  setLocale,
  useLocale,
  useTranslation,
} from "@capybudget/i18n"
import { Globe } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface LanguageSelectProps {
  className?: string
  size?: "sm" | "default"
  /** Show a leading globe icon — useful for compact, label-less placements. */
  withIcon?: boolean
  id?: string
}

export function LanguageSelect({
  className,
  size = "default",
  withIcon = false,
  id,
}: LanguageSelectProps) {
  const { t } = useTranslation("common")
  const locale = useLocale()

  return (
    <Select
      value={locale}
      onValueChange={(v) => {
        if (typeof v === "string" && isSupportedLocale(v)) void setLocale(v)
      }}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={className}
        aria-label={t("language.label")}
      >
        {withIcon && <Globe className="text-muted-foreground" />}
        <SelectValue>
          {(value: string | null) =>
            SUPPORTED_LOCALES.find((l) => l.code === value)?.label ?? value
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
