import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryGroupSection } from "@/components/budget/category-group-section";
import { CATEGORY_GROUP_ORDER } from "@/lib/queries";
import { useCreateCategory } from "@/hooks/use-category-mutations";
import type { Category } from "@/lib/types";
import { toast } from "sonner";

interface CategoryPanelProps {
  categories: Category[];
}

export function CategoryPanel({ categories }: CategoryPanelProps) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const createCategory = useCreateCategory();

  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);

  // Show all groups that have categories, plus any from the default order
  const activeGroups = new Set(activeCategories.map((c) => c.group));
  const allGroups = [...CATEGORY_GROUP_ORDER, ...Array.from(activeGroups)].filter(
    (g, i, arr) => arr.indexOf(g) === i,
  );

  function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setAddingGroup(false);
      return;
    }
    // Create a first category in this new group to make it appear
    createCategory.mutate(
      { name: "New Category", group: name },
      {
        onSuccess: () => {
          toast.success(`Group "${name}" created`);
          setNewGroupName("");
          setAddingGroup(false);
        },
      },
    );
  }

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

      {addingGroup ? (
        <div className="mt-4 flex items-center gap-2">
          <Input
            autoFocus
            placeholder="Group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onBlur={handleAddGroup}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddGroup();
              if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); }
            }}
            className="h-8 text-sm"
          />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-4 gap-2"
          onClick={() => setAddingGroup(true)}
        >
          <Plus className="h-4 w-4" />
          Add Group
        </Button>
      )}
    </div>
  );
}
