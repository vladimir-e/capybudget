import { useState, useEffect } from "react"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface InstructionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instructions: string
  onSave: (text: string) => Promise<void>
  onStartNewChat?: () => void
}

export function InstructionsDialog({
  open,
  onOpenChange,
  instructions,
  onSave,
  onStartNewChat,
}: InstructionsDialogProps) {
  const { t } = useTranslation(["capy", "common"])
  const [draft, setDraft] = useState(instructions)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(instructions)
  }, [open, instructions])

  const hasChanges = draft !== instructions

  const save = async (then?: () => void) => {
    setSaving(true)
    try {
      if (hasChanges) await onSave(draft)
      then?.()
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("instructionsDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("instructionsDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("instructionsDialog.placeholder")}
          rows={8}
          className="w-full resize-none rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand/50"
        />

        <DialogFooter>
          <Button
            onClick={() => void save()}
            disabled={!hasChanges || saving}
            size="sm"
          >
            {saving ? t("common:actions.saving") : t("common:actions.save")}
          </Button>
        </DialogFooter>

        {onStartNewChat && (
          <p className="text-right text-xs text-muted-foreground">
            {t("instructionsDialog.appliesToNewChats")}{" "}
            <button
              type="button"
              onClick={() => void save(onStartNewChat)}
              disabled={saving}
              className="action-link cursor-pointer"
            >
              {t("instructionsDialog.startNewChat")}
            </button>
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
