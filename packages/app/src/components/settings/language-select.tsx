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
          {(value: string | null) => {
            const l = SUPPORTED_LOCALES.find((l) => l.code === value)
            return l ? `${l.code.toUpperCase()} · ${l.label}` : value
          }}
        </SelectValue>
      </SelectTrigger>
      {/* The popup defaults to the trigger's width, which is sized by the active
          language — long endonyms like "Português (Brasil)" would clip. Let it
          grow to its content instead, never narrower than the trigger. */}
      <SelectContent className="w-auto min-w-(--anchor-width)">
        {SUPPORTED_LOCALES.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {`${l.code.toUpperCase()} · ${l.label}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
