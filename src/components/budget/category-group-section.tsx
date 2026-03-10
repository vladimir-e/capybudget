import { ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Category } from "@/lib/types";
import { toast } from "sonner";
import { useState } from "react";

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

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
          onClick={() => toast.info("Add category — coming in Phase 2")}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="ml-4 space-y-0.5">
          {categories.map((category) => (
            <div
              key={category.id}
              className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-50 cursor-grab" />
              <span className="flex-1 text-sm">{category.name}</span>

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
                  <DropdownMenuItem
                    onClick={() => toast.info("Rename category — coming in Phase 2")}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => toast.info("Archive category — coming in Phase 2")}
                  >
                    Archive
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
