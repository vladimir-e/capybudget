import { useState, useMemo, useCallback } from "react";
import { Plus, GripVertical } from "lucide-react";
import { DndContext, DragOverlay, closestCorners } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryGroupSection } from "@/components/budget/category-group-section";
import { CATEGORY_GROUP_ORDER } from "@/lib/queries";
import {
  useCreateCategory,
  useReorderCategoryDnd,
} from "@/hooks/use-category-mutations";
import { useCategoryDnd, type ReorderPatch } from "@/hooks/use-category-dnd";
import type { Category } from "@/lib/types";
import { toast } from "sonner";

interface CategoryPanelProps {
  categories: Category[];
}

export function CategoryPanel({ categories }: CategoryPanelProps) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const createCategory = useCreateCategory();
  const reorderDnd = useReorderCategoryDnd();

  const handleReorder = useCallback(
    (patches: ReorderPatch[]) => {
      reorderDnd.mutate(patches);
    },
    [reorderDnd],
  );

  const {
    sensors,
    activeItem,
    getGroupItems,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useCategoryDnd(categories, handleReorder);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);

  const activeGroups = new Set(activeCategories.map((c) => c.group));
  const allGroups = [
    ...CATEGORY_GROUP_ORDER,
    ...Array.from(activeGroups),
  ].filter((g, i, arr) => arr.indexOf(g) === i);

  function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name) {
      setAddingGroup(false);
      return;
    }
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-2">
        {allGroups.map((group) => {
          const itemIds = getGroupItems(group);
          if (itemIds.length === 0 && !activeItem) return null;

          return (
            <CategoryGroupSection
              key={group}
              group={group}
              itemIds={itemIds}
              categoryById={categoryById}
            />
          );
        })}

        {(archivedCategories.length > 0 || !!activeItem) && (
          <CategoryGroupSection
            group="Archived"
            itemIds={getGroupItems("Archived")}
            categoryById={categoryById}
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
                if (e.key === "Escape") {
                  setAddingGroup(false);
                  setNewGroupName("");
                }
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

      <DragOverlay>
        {activeItem ? (
          <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-md">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{activeItem.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
