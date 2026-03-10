import { createFileRoute } from "@tanstack/react-router";
import { CategoryPanel } from "@/components/budget/category-panel";
import { useCategories } from "@/hooks/use-budget-data";

export const Route = createFileRoute("/budget/categories")({
  component: CategoriesView,
});

function CategoriesView() {
  const { data: categories = [] } = useCategories();

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold mb-4">Categories</h2>
      <CategoryPanel categories={categories} />
    </div>
  );
}
