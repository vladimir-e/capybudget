import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CategoryGroupSection } from "@/components/budget/category-group-section";
import type { Category, CategoryGroup } from "@/lib/types";
import { toast } from "sonner";

interface CategoryPanelProps {
  categories: Category[];
}

const GROUP_ORDER: CategoryGroup[] = [
  "Income",
  "Fixed",
  "Daily Living",
  "Personal",
  "Irregular",
];

export function CategoryPanel({ categories }: CategoryPanelProps) {
  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);

  // Collect groups: known groups in order, then any custom groups
  const knownGroups = new Set<string>(GROUP_ORDER);
  const customGroups = [
    ...new Set(
      activeCategories
        .map((c) => c.group)
        .filter((g) => !knownGroups.has(g)),
    ),
  ];
  const allGroups = [...GROUP_ORDER, ...customGroups];

  return (
    <div className="space-y-2">
      {allGroups.map((group) => {
        const groupCategories = activeCategories
          .filter((c) => c.group === group)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        if (groupCategories.length === 0) return null;

        return (
          <CategoryGroupSection
            key={group}
            group={group}
            categories={groupCategories}
          />
        );
      })}

      {archivedCategories.length > 0 && (
        <CategoryGroupSection
          group="Archived"
          categories={archivedCategories}
          defaultOpen={false}
        />
      )}

      <Button
        variant="outline"
        size="sm"
        className="mt-4 gap-2"
        onClick={() => toast.info("Add group — coming in Phase 2")}
      >
        <Plus className="h-4 w-4" />
        Add Group
      </Button>
    </div>
  );
}
