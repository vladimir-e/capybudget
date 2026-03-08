import { createFileRoute } from "@tanstack/react-router";
import { CategoryPanel } from "@/components/budget/category-panel";
import { MOCK_CATEGORIES } from "@/lib/mock-data";

export const Route = createFileRoute("/budget/categories")({
  component: CategoriesView,
});

function CategoriesView() {
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold mb-4">Categories</h2>
      <CategoryPanel categories={MOCK_CATEGORIES} />
    </div>
  );
}
