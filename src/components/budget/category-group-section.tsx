import { useState } from "react";
import {
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useArchiveCategory,
  useUnarchiveCategory,
} from "@/hooks/use-category-mutations";
import type { Category } from "@capybudget/core";
import { toast } from "sonner";

interface CategoryGroupSectionProps {
  group: string;
  itemIds: string[];
  categoryById: Map<string, Category>;
  defaultOpen?: boolean;
}

export function CategoryGroupSection({
  group,
  itemIds,
  categoryById,
  defaultOpen = true,
}: CategoryGroupSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "archive" | "delete";
    categoryId: string;
    categoryName: string;
  } | null>(null);

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const archiveCategory = useArchiveCategory();
  const unarchiveCategory = useUnarchiveCategory();

  const { setNodeRef: setDroppableRef } = useDroppable({ id: group });

  function handleAdd() {
    if (!addName.trim()) {
      setAdding(false);
      return;
    }
    createCategory.mutate(
      { name: addName.trim(), group },
      {
        onSuccess: () => {
          toast.success("Category added");
          setAddName("");
          setAdding(false);
        },
      },
    );
  }

  function startRename(category: Category) {
    setRenamingId(category.id);
    setRenameValue(category.name);
  }

  function handleRename(category: Category) {
    if (!renameValue.trim() || renameValue.trim() === category.name) {
      setRenamingId(null);
      return;
    }
    updateCategory.mutate(
      { id: category.id, name: renameValue.trim(), group: category.group },
      {
        onSuccess: () => {
          toast.success("Category renamed");
          setRenamingId(null);
        },
      },
    );
  }

  function handleArchive(category: Category) {
    if (category.archived) {
      unarchiveCategory.mutate(category.id, {
        onSuccess: () => toast.success(`${category.name} unarchived`),
      });
    } else {
      setPendingAction({
        type: "archive",
        categoryId: category.id,
        categoryName: category.name,
      });
    }
  }

  function handleDelete(category: Category) {
    setPendingAction({
      type: "delete",
      categoryId: category.id,
      categoryName: category.name,
    });
  }

  function confirmPendingAction() {
    if (!pendingAction) return;
    if (pendingAction.type === "archive") {
      archiveCategory.mutate(pendingAction.categoryId, {
        onSuccess: () => toast.success(`${pendingAction.categoryName} archived`),
      });
    } else {
      deleteCategory.mutate(pendingAction.categoryId, {
        onSuccess: () => toast.success(`${pendingAction.categoryName} deleted`),
      });
    }
    setPendingAction(null);
  }

  const isArchived = group === "Archived";

  return (
    <div ref={setDroppableRef}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
              />
            }
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </CollapsibleTrigger>

          <CollapsibleTrigger className="flex-1 text-left">
            <span className="text-sm font-medium">{group}</span>
            <span className="text-muted-foreground text-xs ml-2">
              ({itemIds.length})
            </span>
          </CollapsibleTrigger>

          {!isArchived && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
              onClick={() => {
                setAdding(true);
                setOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <SortableContext
            items={itemIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="ml-4 space-y-0.5">
              {itemIds.map((id) => {
                const category = categoryById.get(id);
                if (!category) return null;
                return (
                  <SortableCategoryRow
                    key={id}
                    category={category}
                    isRenaming={renamingId === id}
                    renameValue={renameValue}
                    onRenameValueChange={setRenameValue}
                    onRenameConfirm={() => handleRename(category)}
                    onRenameCancel={() => setRenamingId(null)}
                    onStartRename={() => startRename(category)}
                    onArchive={() => handleArchive(category)}
                    onDelete={() => handleDelete(category)}
                    isArchived={isArchived}
                  />
                );
              })}

              {adding && (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <Input
                    autoFocus
                    placeholder="Category name"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    onBlur={handleAdd}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAdd();
                      if (e.key === "Escape") {
                        setAdding(false);
                        setAddName("");
                      }
                    }}
                    className="h-6 flex-1 text-sm px-1 py-0"
                  />
                </div>
              )}
            </div>
          </SortableContext>
        </CollapsibleContent>
      </Collapsible>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(isOpen) => { if (!isOpen) setPendingAction(null); }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.type === "archive" ? "Archive" : "Delete"}{" "}
              {pendingAction?.categoryName}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.type === "archive"
                ? "Archived categories won't appear in selectors."
                : "This will remove the category. Transactions using it will become uncategorized."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button
              variant={pendingAction?.type === "delete" ? "destructive" : "default"}
              onClick={confirmPendingAction}
            >
              {pendingAction?.type === "archive" ? "Archive" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sortable Category Row ──────────────────────────────────

interface SortableCategoryRowProps {
  category: Category;
  isRenaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onStartRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
  isArchived: boolean;
}

function SortableCategoryRow({
  category,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRenameConfirm,
  onRenameCancel,
  onStartRename,
  onArchive,
  onDelete,
  isArchived,
}: SortableCategoryRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/row flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent"
    >
      <button
        className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground/30 hover:text-muted-foreground/60 cursor-grab active:cursor-grabbing touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {isRenaming ? (
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onBlur={onRenameConfirm}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameConfirm();
            if (e.key === "Escape") onRenameCancel();
          }}
          className="h-6 flex-1 text-sm px-1 py-0"
        />
      ) : (
        <span className="flex-1 text-sm">{category.name}</span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover/row:opacity-100"
            />
          }
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isArchived && (
            <DropdownMenuItem onClick={onStartRename}>
              Rename
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onArchive}>
            {isArchived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
