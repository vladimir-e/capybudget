import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import type { Category } from "@/lib/types";
import { ChevronDown, X } from "lucide-react";

interface CategorySelectorProps {
  categories: Category[];
  value: string | null;
  onChange: (categoryId: string | null) => void;
  placeholder?: string;
  /** Show "All Categories" as the first option (for filter use cases). */
  includeAll?: boolean;
  /** Show "Uncategorized" option to clear the selection (for form use cases). */
  includeUncategorized?: boolean;
  /** Show a clear button when a category is selected. */
  clearable?: boolean;
}

export function CategorySelector({
  categories,
  value,
  onChange,
  placeholder = "Select category…",
  includeAll = false,
  includeUncategorized = false,
  clearable = false,
}: CategorySelectorProps) {
  const [open, setOpen] = useState(false);

  const active = categories.filter((c) => !c.archived);
  const groups = [...new Set(active.map((c) => c.group))];

  const selectedLabel =
    value === null && includeAll
      ? "All Categories"
      : active.find((c) => c.id === value)?.name ?? placeholder;

  const showClear = clearable && value !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="flex items-center">
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={`h-8 justify-between gap-1.5 font-normal ${showClear ? "rounded-r-none border-r-0" : ""}`}
            />
          }
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        {showClear && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex h-8 items-center rounded-r-lg border border-input px-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label="Clear category filter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search categories…" />
          <CommandList>
            <CommandEmpty>No categories found.</CommandEmpty>
            {includeAll && (
              <CommandGroup>
                <CommandItem
                  value="All Categories"
                  data-checked={value === null}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  All Categories
                </CommandItem>
              </CommandGroup>
            )}
            {includeUncategorized && (
              <CommandGroup>
                <CommandItem
                  value="Uncategorized"
                  data-checked={value === null}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground italic">Uncategorized</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((group) => (
              <CommandGroup key={group} heading={group}>
                {active
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.name}
                      data-checked={c.id === value}
                      onSelect={() => {
                        onChange(c.id);
                        setOpen(false);
                      }}
                    >
                      {c.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
