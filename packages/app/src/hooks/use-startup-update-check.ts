import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
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
  const ran = useRef(false)

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return
    if (ran.current) return
    ran.current = true

    const timer = setTimeout(() => {
      void checkForUpdate()
        .then((update) => {
          if (!update) return
          toast(`Capy ${update.version} available`, {
            action: {
              label: "Update",
              onClick: () =>
                navigate({
                  to: "/budget/settings",
                  search: { path, name, section: "updates" },
                }),
            },
          })
        })
        .catch((err) => console.warn("update check failed:", err))
    }, DEFER_MS)

    return () => clearTimeout(timer)
  }, [path, name, navigate])
}
