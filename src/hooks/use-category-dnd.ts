import { useState, useCallback } from "react";
import {
  useSensors,
  useSensor,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import type { Category, CategoryGroup } from "@capybudget/core";

const ARCHIVED_GROUP = "Archived";

type ContainerItems = Map<string, string[]>;

function buildContainerItems(categories: Category[]): ContainerItems {
  const map = new Map<string, string[]>();
  const byId = new Map(categories.map((c) => [c.id, c]));

  for (const cat of categories) {
    const group = cat.archived ? ARCHIVED_GROUP : cat.group;
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(cat.id);
  }

  for (const [, ids] of map) {
    ids.sort(
      (a, b) => (byId.get(a)?.sortOrder ?? 0) - (byId.get(b)?.sortOrder ?? 0),
    );
  }

  if (!map.has(ARCHIVED_GROUP)) map.set(ARCHIVED_GROUP, []);
  return map;
}

function findContainer(
  id: string,
  items: ContainerItems,
): string | undefined {
  if (items.has(id)) return id;
  for (const [container, ids] of items) {
    if (ids.includes(id)) return container;
  }
  return undefined;
}

// ── Patch computation ────────────────────────────────────────

export interface ReorderPatch {
  id: string;
  changes: Partial<Category>;
}

function computePatches(
  categories: Category[],
  activeId: string,
  targetGroup: string,
  targetOrder: string[],
  sourceGroup: string,
  sourceOrder: string[],
): ReorderPatch[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const patches: ReorderPatch[] = [];
  if (!byId.has(activeId)) return patches;

  const isCrossGroup = sourceGroup !== targetGroup;

  if (isCrossGroup) {
    const changes: Partial<Category> = {};
    if (targetGroup === ARCHIVED_GROUP) {
      changes.archived = true;
    } else if (sourceGroup === ARCHIVED_GROUP) {
      changes.archived = false;
      changes.group = targetGroup as CategoryGroup;
    } else {
      changes.group = targetGroup as CategoryGroup;
    }
    if (Object.keys(changes).length > 0) {
      patches.push({ id: activeId, changes });
    }
  }

  for (let i = 0; i < targetOrder.length; i++) {
    const id = targetOrder[i];
    const cat = byId.get(id);
    if (!cat) continue;
    const newSort = i + 1;
    const existing = patches.find((p) => p.id === id);
    if (existing) {
      existing.changes.sortOrder = newSort;
    } else if (cat.sortOrder !== newSort) {
      patches.push({ id, changes: { sortOrder: newSort } });
    }
  }

  if (isCrossGroup) {
    for (let i = 0; i < sourceOrder.length; i++) {
      const id = sourceOrder[i];
      const cat = byId.get(id);
      if (!cat) continue;
      const newSort = i + 1;
      if (cat.sortOrder !== newSort) {
        patches.push({ id, changes: { sortOrder: newSort } });
      }
    }
  }

  return patches;
}

// ── Hook ─────────────────────────────────────────────────────

export function useCategoryDnd(
  categories: Category[],
  onReorder: (patches: ReorderPatch[]) => void,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [activeItem, setActiveItem] = useState<Category | null>(null);
  const [containerItems, setContainerItems] =
    useState<ContainerItems | null>(null);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const cat = categories.find((c) => c.id === String(event.active.id));
      if (!cat) return;
      setActiveItem(cat);
      setContainerItems(buildContainerItems(categories));
    },
    [categories],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over || !containerItems) return;

      const activeContainer = findContainer(String(active.id), containerItems);
      const overContainer = findContainer(String(over.id), containerItems);
      if (
        !activeContainer ||
        !overContainer ||
        activeContainer === overContainer
      )
        return;

      setContainerItems((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        const sourceIds = [...(next.get(activeContainer) ?? [])];
        const targetIds = [...(next.get(overContainer) ?? [])];

        const activeIdx = sourceIds.indexOf(String(active.id));
        if (activeIdx === -1) return prev;

        sourceIds.splice(activeIdx, 1);
        const overIdx = targetIds.indexOf(String(over.id));
        if (overIdx !== -1) {
          targetIds.splice(overIdx, 0, String(active.id));
        } else {
          targetIds.push(String(active.id));
        }

        next.set(activeContainer, sourceIds);
        next.set(overContainer, targetIds);
        return next;
      });
    },
    [containerItems],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!containerItems || !activeItem) {
        setActiveItem(null);
        setContainerItems(null);
        return;
      }

      const activeContainer = findContainer(String(active.id), containerItems);
      if (!activeContainer) {
        setActiveItem(null);
        setContainerItems(null);
        return;
      }

      const sourceGroup = activeItem.archived
        ? ARCHIVED_GROUP
        : activeItem.group;

      let targetOrder = containerItems.get(activeContainer) ?? [];
      if (over) {
        const overContainer = findContainer(String(over.id), containerItems);
        if (overContainer && activeContainer === overContainer) {
          const ids = [...targetOrder];
          const oldIdx = ids.indexOf(String(active.id));
          const newIdx = ids.indexOf(String(over.id));
          if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
            targetOrder = arrayMove(ids, oldIdx, newIdx);
          }
        }
      }

      const sourceOrder =
        sourceGroup !== activeContainer
          ? (containerItems.get(sourceGroup) ?? [])
          : [];

      const patches = computePatches(
        categories,
        String(active.id),
        activeContainer,
        targetOrder,
        sourceGroup,
        sourceOrder,
      );

      if (patches.length > 0) {
        onReorder(patches);
      }

      setActiveItem(null);
      setContainerItems(null);
    },
    [containerItems, activeItem, categories, onReorder],
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    setContainerItems(null);
  }, []);

  const getGroupItems = useCallback(
    (group: string): string[] => {
      if (containerItems) {
        return containerItems.get(group) ?? [];
      }
      if (group === ARCHIVED_GROUP) {
        return categories
          .filter((c) => c.archived)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => c.id);
      }
      return categories
        .filter((c) => !c.archived && c.group === group)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => c.id);
    },
    [containerItems, categories],
  );

  return {
    sensors,
    activeItem,
    getGroupItems,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
