import { useTranslation } from "@capybudget/i18n"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LanguageSelect } from "@/components/settings/language-select"

export function LanguageSection() {
  const { t } = useTranslation("settings")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("language.title")}</CardTitle>
        <CardDescription>{t("language.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <LanguageSelect id="language" className="w-full" />
      </CardContent>
    </Card>
  )
}
