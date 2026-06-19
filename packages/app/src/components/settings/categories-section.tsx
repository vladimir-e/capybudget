import { useTranslation } from "@capybudget/i18n"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CategoryPanel } from "@/components/budget/category-panel"
import { useCategories } from "@/hooks/use-budget-data"

export function CategoriesSection() {
  const { t } = useTranslation("settings")
  const { data: categories = [] } = useCategories()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("categories.title")}</CardTitle>
        <CardDescription>{t("categories.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("categories.count", { count: categories.length })}
        </p>
        <CategoryPanel categories={categories} />
      </CardContent>
    </Card>
  )
}
