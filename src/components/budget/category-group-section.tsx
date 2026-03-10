import { useState } from "react";
import { ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useCreateCategory,
  useUpdateCategory,
  useArchiveCategory,
  useUnarchiveCategory,
} from "@/hooks/use-category-mutations";
import type { Category } from "@/lib/types";
import { toast } from "sonner";

interface CategoryGroupSectionProps {
  group: string;
  categories: Category[];
  defaultOpen?: boolean;
}

export function CategoryGroupSection({
  group,
  categories,
  defaultOpen = true,
}: CategoryGroupSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const archiveCategory = useArchiveCategory();
  const unarchiveCategory = useUnarchiveCategory();

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
      archiveCategory.mutate(category.id, {
        onSuccess: () => toast.success(`${category.name} archived`),
      });
    }
  }

  const isArchived = group === "Archived";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent">
        <CollapsibleTrigger
          render={<Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" />}
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </CollapsibleTrigger>

        <CollapsibleTrigger className="flex-1 text-left">
          <span className="text-sm font-medium">{group}</span>
          <span className="text-muted-foreground text-xs ml-2">
            ({categories.length})
          </span>
        </CollapsibleTrigger>

        {!isArchived && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={() => { setAdding(true); setOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <CollapsibleContent>
        <div className="ml-4 space-y-0.5">
          {categories.map((category) => (
            <div
              key={category.id}
              className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-50 cursor-grab" />

              {renamingId === category.id ? (
                <Input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(category)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(category);
                    if (e.key === "Escape") setRenamingId(null);
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
                      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                    />
                  }
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isArchived && (
                    <DropdownMenuItem onClick={() => startRename(category)}>
                      Rename
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleArchive(category)}>
                    {category.archived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}

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
                  if (e.key === "Escape") { setAdding(false); setAddName(""); }
                }}
                className="h-6 flex-1 text-sm px-1 py-0"
              />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
