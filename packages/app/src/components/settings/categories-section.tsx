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
  const { data: categories = [] } = useCategories()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>
          Organize the groups and categories your transactions are sorted into.
          Drag to reorder, rename inline, or archive ones you no longer use.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CategoryPanel categories={categories} />
      </CardContent>
    </Card>
  )
}
