import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { i18n } from "@capybudget/i18n"
import { checkForUpdate } from "@/lib/updater"

interface StartupUpdateCheckArgs {
  path: string
  name: string
  navigate: ReturnType<typeof useNavigate>
}

// Defer past first paint so the GitHub round-trip never blocks the budget
// rendering. A network failure or rate-limit shouldn't bother the user —
// they'll be offered the update on the next launch.
const DEFER_MS = 1500

export function useStartupUpdateCheck({ path, name, navigate }: StartupUpdateCheckArgs) {
  // The check fires once, but the toast's deep-link must point at whatever
  // budget is open when the user clicks it — not the one open at first mount.
  const latest = useRef({ path, name, navigate })
  useEffect(() => {
    latest.current = { path, name, navigate }
  })

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return

    const timer = setTimeout(() => {
      void checkForUpdate()
        .then((update) => {
          if (!update) return
          toast(i18n.t("common:update.available", { version: update.version }), {
            action: {
              label: i18n.t("common:update.action"),
              onClick: () => {
                const { path, name, navigate } = latest.current
                navigate({
                  to: "/budget/settings",
                  search: { path, name, section: "updates" },
                })
              },
            },
          })
        })
        .catch((err) => console.warn("update check failed:", err))
    }, DEFER_MS)

    return () => clearTimeout(timer)
  }, [])
}
