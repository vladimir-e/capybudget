import { useTranslation } from "@capybudget/i18n"
import capyMascot from "@/assets/capy-neutral.webp"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useIntelligenceStore } from "@/stores/intelligence-store"

/**
 * One-time heads-up before the first keychain read of an install, so the OS's
 * "wants to use your confidential information" prompt lands in a context the
 * user understands. Dismissing simply doesn't load yet — no cancel-path state.
 * Mounted once (BudgetShell); driven entirely by the intelligence store.
 */
export function SecretAccessDialog() {
  const { t } = useTranslation("capy")
  const open = useIntelligenceStore((s) => s.secretGateOpen)
  const confirm = useIntelligenceStore((s) => s.confirmSecretGate)
  const dismiss = useIntelligenceStore((s) => s.dismissSecretGate)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss() }}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img
              src={capyMascot}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
            <DialogTitle>{t("secretGate.title")}</DialogTitle>
          </div>
          <DialogDescription>{t("secretGate.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={confirm}>{t("secretGate.allow")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
