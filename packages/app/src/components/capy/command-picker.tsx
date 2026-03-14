import { useState } from "react"
import { ChevronUp, Pencil, Plus, Trash2, X, Check } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { CapyCommand } from "./capy-commands"

interface CommandPickerProps {
  commands: CapyCommand[]
  onSelect: (prompt: string) => void
  onSave: (commands: CapyCommand[]) => Promise<void>
}

export function CommandPicker({ commands, onSelect, onSave }: CommandPickerProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editPrompt, setEditPrompt] = useState("")
  const [adding, setAdding] = useState(false)

  const handleSelect = (cmd: CapyCommand) => {
    if (editing) return
    onSelect(cmd.prompt)
    setOpen(false)
  }

  const startEdit = (cmd: CapyCommand) => {
    setEditing(cmd.id)
    setEditName(cmd.name)
    setEditPrompt(cmd.prompt)
  }

  const cancelEdit = () => {
    setEditing(null)
    setAdding(false)
  }

  const saveEdit = async () => {
    if (!editName.trim() || !editPrompt.trim()) return

    if (adding) {
      const newCmd: CapyCommand = {
        id: crypto.randomUUID(),
        name: editName.trim(),
        prompt: editPrompt.trim(),
      }
      await onSave([...commands, newCmd])
    } else if (editing) {
      await onSave(
        commands.map((c) =>
          c.id === editing
            ? { ...c, name: editName.trim(), prompt: editPrompt.trim() }
            : c,
        ),
      )
    }
    setEditing(null)
    setAdding(false)
  }

  const deleteCommand = async (id: string) => {
    await onSave(commands.filter((c) => c.id !== id))
    setEditing(null)
  }

  const startAdd = () => {
    setAdding(true)
    setEditing("__new__")
    setEditName("")
    setEditPrompt("")
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) cancelEdit()
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
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
        className="w-72 p-1"
      >
        <div className="py-1">
          {commands.map((cmd) =>
            editing === cmd.id ? (
              <EditRow
                key={cmd.id}
                name={editName}
                prompt={editPrompt}
                onNameChange={setEditName}
                onPromptChange={setEditPrompt}
                onSave={saveEdit}
                onCancel={cancelEdit}
                onDelete={() => deleteCommand(cmd.id)}
              />
            ) : (
              <div
                key={cmd.id}
                className="group flex items-center gap-1 rounded-md hover:bg-muted/60 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => handleSelect(cmd)}
                  className="flex-1 px-3 py-2 text-left text-sm text-foreground/80 truncate"
                >
                  {cmd.name}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(cmd)}
                  className="p-1.5 text-muted-foreground/40 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Edit command"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ),
          )}
          {adding && editing === "__new__" && (
            <EditRow
              name={editName}
              prompt={editPrompt}
              onNameChange={setEditName}
              onPromptChange={setEditPrompt}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          )}
          {!adding && (
            <button
              type="button"
              onClick={startAdd}
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add command
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function EditRow({
  name,
  prompt,
  onNameChange,
  onPromptChange,
  onSave,
  onCancel,
  onDelete,
}: {
  name: string
  prompt: string
  onNameChange: (v: string) => void
  onPromptChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}) {
  return (
    <div className="rounded-md bg-muted/40 p-2 space-y-1.5">
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Command name"
        className="w-full rounded bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/40 border border-border/50 focus:outline-none focus:ring-1 focus:ring-brand/50"
        autoFocus
      />
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="Prompt to send..."
        rows={2}
        className="w-full rounded bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 border border-border/50 focus:outline-none focus:ring-1 focus:ring-brand/50 resize-none"
      />
      <div className="flex items-center justify-between">
        <div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="p-1 text-muted-foreground/50 hover:text-destructive transition-colors"
              aria-label="Delete command"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!name.trim() || !prompt.trim()}
            className="p-1 text-brand hover:text-brand/80 disabled:opacity-30 transition-colors"
            aria-label="Save"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
