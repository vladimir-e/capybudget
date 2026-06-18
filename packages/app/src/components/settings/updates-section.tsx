import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import type { Update } from "@tauri-apps/plugin-updater"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { checkForUpdate, installUpdate } from "@/lib/updater"

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; pct: number | null }
  | { kind: "installing" }
  | { kind: "error"; message: string }

export function UpdatesSection() {
  const [status, setStatus] = useState<Status>(() =>
    "__TAURI_INTERNALS__" in window ? { kind: "checking" } : { kind: "idle" },
  )
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return
    let cancelled = false
    void getVersion().then((v) => {
      if (!cancelled) setVersion(v)
    })
    // Auto-check on open so an already-known update (boot toast deep-link, or
    // just opening the panel) surfaces immediately, without a second click.
    void checkForUpdate()
      .then((update) => {
        if (cancelled) return
        setStatus(update ? { kind: "available", update } : { kind: "up-to-date" })
      })
      .catch((err) => {
        if (cancelled) return
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCheck() {
    setStatus({ kind: "checking" })
    try {
      const update = await checkForUpdate()
      setStatus(update ? { kind: "available", update } : { kind: "up-to-date" })
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleInstall(update: Update) {
    setStatus({ kind: "downloading", pct: null })
    try {
      await installUpdate(update, ({ downloaded, total }) => {
        const pct = total ? Math.round((downloaded / total) * 100) : null
        setStatus({ kind: "downloading", pct })
      })
      // relaunch() is imminent and will tear down the window; show the
      // restarting state in the brief window before it does.
      setStatus({ kind: "installing" })
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  const busy =
    status.kind === "checking" ||
    status.kind === "downloading" ||
    status.kind === "installing"

  const showCheckButton =
    status.kind === "idle" || status.kind === "up-to-date" || status.kind === "error"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>Keep Capy up to date.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {version && (
          <p className="text-sm text-muted-foreground">Current version {version}</p>
        )}

        {status.kind === "checking" && (
          <p className="text-sm text-muted-foreground">Checking for updates…</p>
        )}

        {status.kind === "up-to-date" && (
          <p className="text-sm text-muted-foreground">You're on the latest version.</p>
        )}

        {status.kind === "available" && (
          <div className="space-y-3">
            <p className="text-sm">Capy {status.update.version} is available.</p>
            <Button size="sm" onClick={() => handleInstall(status.update)}>
              Install &amp; restart
            </Button>
          </div>
        )}

        {status.kind === "downloading" && (
          <div className="space-y-2">
            {status.pct !== null ? (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${status.pct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Downloading… {status.pct}%</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Downloading…</p>
            )}
          </div>
        )}

        {status.kind === "installing" && (
          <p className="text-sm text-muted-foreground">Restarting…</p>
        )}

        {status.kind === "error" && (
          <p className="text-sm text-destructive">{status.message}</p>
        )}

        {showCheckButton && (
          <Button variant="outline" size="sm" onClick={handleCheck} disabled={busy}>
            <RefreshCw className="h-4 w-4" />
            Check for updates
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
