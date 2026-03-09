import { createFileRoute } from "@tanstack/react-router";
import { CategoryPanel } from "@/components/budget/category-panel";
import { useBudget } from "@/contexts/budget-context";

export const Route = createFileRoute("/budget/categories")({
  component: CategoriesView,
});

function CategoriesView() {
  const { categories } = useBudget();

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold mb-4">Categories</h2>
      <CategoryPanel categories={categories} />
    </div>
  );
}
