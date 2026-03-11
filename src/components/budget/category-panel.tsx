import { useState, useCallback } from "react";
import { Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryGroupSection } from "@/components/budget/category-group-section";
import { CATEGORY_GROUP_ORDER } from "@/lib/queries";
import {
  useCreateCategory,
  useReorderCategories,
  useMoveCategory,
} from "@/hooks/use-category-mutations";
import type { Category } from "@/lib/types";
import { toast } from "sonner";

interface CategoryPanelProps {
  categories: Category[];
}

export function CategoryPanel({ categories }: CategoryPanelProps) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const createCategory = useCreateCategory();
  const reorderCategories = useReorderCategories();
  const moveCategoryMutation = useMoveCategory();

  const activeCategories = categories.filter((c) => !c.archived);
  const archivedCategories = categories.filter((c) => c.archived);

  const activeGroups = new Set(activeCategories.map((c) => c.group));
  const allGroups = [...CATEGORY_GROUP_ORDER, ...Array.from(activeGroups)].filter(
    (g, i, arr) => arr.indexOf(g) === i,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeCategory = activeId
    ? categories.find((c) => c.id === activeId)
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const draggedCategory = categories.find((c) => c.id === active.id);
      if (!draggedCategory) return;

      const overId = String(over.id);

      let targetGroup: string;
      let targetIndex: number;

      if (overId.startsWith("group:")) {
        // Dropped on a group header → append to end
        targetGroup = overId.slice(6);
        const groupCats =
          targetGroup === "Archived"
            ? archivedCategories
            : activeCategories.filter(
                (c) => c.group === targetGroup && c.id !== draggedCategory.id,
              );
        targetIndex = groupCats.length;
      } else {
        // Dropped on a category
        const overCategory = categories.find((c) => c.id === overId);
        if (!overCategory) return;

        targetGroup = overCategory.archived ? "Archived" : overCategory.group;

        const groupCats = (
          targetGroup === "Archived"
            ? archivedCategories
            : activeCategories.filter((c) => c.group === targetGroup)
        )
          .filter((c) => c.id !== draggedCategory.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        targetIndex = groupCats.findIndex((c) => c.id === overId);
        if (targetIndex === -1) targetIndex = groupCats.length;
      }

      const sourceGroup = draggedCategory.archived
        ? "Archived"
        : draggedCategory.group;

      if (sourceGroup === targetGroup && targetGroup !== "Archived") {
        // Same group → reorder
        const groupCats = activeCategories
          .filter((c) => c.group === targetGroup)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const ids = groupCats.map((c) => c.id);
        const oldIndex = ids.indexOf(active.id as string);
        const newIndex = ids.indexOf(over.id as string);

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const reordered = [...ids];
          reordered.splice(oldIndex, 1);
          reordered.splice(newIndex, 0, active.id as string);
          reorderCategories.mutate({
            group: targetGroup,
            orderedIds: reordered,
          });
        }
      } else {
        // Cross-group move (or to/from Archived)
        moveCategoryMutation.mutate({
          categoryId: active.id as string,
          targetGroup,
          targetIndex,
        });
      }
    },
    [categories, activeCategories, archivedCategories, reorderCategories, moveCategoryMutation],
  );

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
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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

      <DragOverlay>
        {activeCategory ? (
          <div className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-lg">
            {activeCategory.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
