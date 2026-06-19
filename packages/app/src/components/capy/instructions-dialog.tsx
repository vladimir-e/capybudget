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
}

export function InstructionsDialog({
  open,
  onOpenChange,
  instructions,
  onSave,
}: InstructionsDialogProps) {
  const { t } = useTranslation(["capy", "common"])
  const [draft, setDraft] = useState(instructions)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(instructions)
  }, [open, instructions])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = draft !== instructions

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
            onClick={handleSave}
            disabled={!hasChanges || saving}
            size="sm"
          >
            {saving ? t("common:actions.saving") : t("common:actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
