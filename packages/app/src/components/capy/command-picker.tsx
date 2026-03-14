import { useState } from "react"
import { ChevronUp } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DEFAULT_COMMANDS, type CapyCommand } from "./capy-commands"

interface CommandPickerProps {
  onSelect: (prompt: string) => void
}

export function CommandPicker({ onSelect }: CommandPickerProps) {
  const [open, setOpen] = useState(false)

  const handleSelect = (cmd: CapyCommand) => {
    onSelect(cmd.prompt)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          />
        }
      >
        Commands
        <ChevronUp className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 p-1"
      >
        <div className="py-1">
          {DEFAULT_COMMANDS.map((cmd) => (
            <button
              key={cmd.id}
              type="button"
              onClick={() => handleSelect(cmd)}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground/80 hover:bg-muted/60 transition-colors"
            >
              {cmd.name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
