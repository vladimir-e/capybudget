import { useTranslation } from "@capybudget/i18n"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function MasUpdatesNote() {
  const { t } = useTranslation("settings")
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("updates.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t("updates.masManaged")}</p>
      </CardContent>
    </Card>
  )
}
